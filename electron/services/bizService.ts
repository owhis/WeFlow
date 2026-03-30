import { join } from 'path'
import { readdirSync, existsSync } from 'fs'
import { wcdbService } from './wcdbService'
import { dbPathService } from './dbPathService'
import { ConfigService } from './config'
import * as fzstd from 'fzstd'
import { DOMParser } from '@xmldom/xmldom'
import { ipcMain } from 'electron'
import { createHash } from 'crypto'
import {ContactCacheService} from "./contactCacheService";

export interface BizAccount {
  username: string
  name: string
  avatar: string
  type: number
  last_time: number
  formatted_last_time: string
}

export interface BizMessage {
  local_id: number
  create_time: number
  title: string
  des: string
  url: string
  cover: string
  content_list: any[]
}

export interface BizPayRecord {
  local_id: number
  create_time: number
  title: string
  description: string
  merchant_name: string
  merchant_icon: string
  timestamp: number
  formatted_time: string
}

export class BizService {
  private configService: ConfigService
  constructor() {
    this.configService = new ConfigService()
  }

  private getAccountDir(account?: string): string {
    const root = dbPathService.getDefaultPath()
    if (account) {
      return join(root, account)
    }
    // Default to the first scanned account if no account specified
    const candidates = dbPathService.scanWxids(root)
    if (candidates.length > 0) {
      return join(root, candidates[0].wxid)
    }
    return root
  }

  private decompressZstd(data: Buffer): string {
    if (!data || data.length < 4) return data.toString('utf-8')
    const magic = data.readUInt32LE(0)
    if (magic !== 0xFD2FB528) {
      return data.toString('utf-8')
    }
    try {
      const decompressed = fzstd.decompress(data)
      return Buffer.from(decompressed).toString('utf-8')
    } catch (e) {
      console.error('[BizService] Zstd decompression failed:', e)
      return data.toString('utf-8')
    }
  }

  private parseBizXml(xmlStr: string): any {
    if (!xmlStr) return null
    try {
      const doc = new DOMParser().parseFromString(xmlStr, 'text/xml')
      const q = (parent: any, selector: string) => {
        const nodes = parent.getElementsByTagName(selector)
        return nodes.length > 0 ? nodes[0].textContent || '' : ''
      }

      const appMsg = doc.getElementsByTagName('appmsg')[0]
      if (!appMsg) return null

      // 提取主封面
      let mainCover = q(appMsg, 'thumburl')
      if (!mainCover) {
        const coverNode = doc.getElementsByTagName('cover')[0]
        if (coverNode) mainCover = coverNode.textContent || ''
      }

      const result = {
        title: q(appMsg, 'title'),
        des: q(appMsg, 'des'),
        url: q(appMsg, 'url'),
        cover: mainCover,
        content_list: [] as any[]
      }

      const items = doc.getElementsByTagName('item')
      for (let i = 0; i < items.length; i++) {
        const item = items[i]
        const itemStruct = {
          title: q(item, 'title'),
          url: q(item, 'url'),
          cover: q(item, 'cover'),
          summary: q(item, 'summary')
        }
        if (itemStruct.title) {
          result.content_list.push(itemStruct)
        }
      }

      return result
    } catch (e) {
      console.error('[BizService] XML parse failed:', e)
      return null
    }
  }

  private parsePayXml(xmlStr: string): any {
    if (!xmlStr) return null
    try {
      const doc = new DOMParser().parseFromString(xmlStr, 'text/xml')
      const q = (parent: any, selector: string) => {
        const nodes = parent.getElementsByTagName(selector)
        return nodes.length > 0 ? nodes[0].textContent || '' : ''
      }

      const appMsg = doc.getElementsByTagName('appmsg')[0]
      const header = doc.getElementsByTagName('template_header')[0]

      const record = {
        title: appMsg ? q(appMsg, 'title') : '',
        description: appMsg ? q(appMsg, 'des') : '',
        merchant_name: header ? q(header, 'display_name') : '微信支付',
        merchant_icon: header ? q(header, 'icon_url') : '',
        timestamp: parseInt(q(doc, 'pub_time') || '0'),
        formatted_time: ''
      }
      return record
    } catch (e) {
      console.error('[BizService] Pay XML parse failed:', e)
      return null
    }
  }

  async listAccounts(account?: string): Promise<BizAccount[]> {
    const root = this.configService.get('dbPath')
    console.log(root)
    let accountWxids: string[] = []
    
    if (account) {
      accountWxids = [account]
    } else {
      const candidates = dbPathService.scanWxids(root)
      accountWxids = candidates.map(c => c.wxid)
    }

    const allBizAccounts: Record<string, BizAccount> = {}

    for (const wxid of accountWxids) {
      const accountDir = join(root, wxid)
      const dbDir = join(accountDir, 'db_storage', 'message')
      if (!existsSync(dbDir)) continue

      const bizDbFiles = readdirSync(dbDir).filter(f => f.startsWith('biz_message') && f.endsWith('.db'))
      if (bizDbFiles.length === 0) continue

      const bizIds = new Set<string>()
      const bizLatestTime: Record<string, number> = {}

      for (const file of bizDbFiles) {
        const dbPath = join(dbDir, file)
        console.log(`path: ${dbPath}`)
        const name2idRes = await wcdbService.execQuery('biz', dbPath, 'SELECT username FROM Name2Id')
        console.log(`name2idRes success: ${name2idRes.success}`)
        console.log(`name2idRes length: ${name2idRes.rows?.length}`)

        if (name2idRes.success && name2idRes.rows) {
          for (const row of name2idRes.rows) {
            if (row.username) {
              const uname = row.username
              bizIds.add(uname)

              const md5Id = createHash('md5').update(uname).digest('hex').toLowerCase()
              const tableName = `Msg_${md5Id}`
              const timeRes = await wcdbService.execQuery('biz', dbPath, `SELECT MAX(create_time) as max_time FROM ${tableName}`)
              if (timeRes.success && timeRes.rows && timeRes.rows[0]?.max_time) {
                const t = timeRes.rows[0].max_time
                bizLatestTime[uname] = Math.max(bizLatestTime[uname] || 0, t)
              }
            }
          }
        }
      }

      if (bizIds.size === 0) continue

      const contactDbPath = join(accountDir, 'contact.db')
      if (existsSync(contactDbPath)) {
        const idsArray = Array.from(bizIds)
        const batchSize = 100
        for (let i = 0; i < idsArray.length; i += batchSize) {
          const batch = idsArray.slice(i, i + batchSize)
          const placeholders = batch.map(() => '?').join(',')
          
          const contactRes = await wcdbService.execQuery('contact', contactDbPath, 
            `SELECT username, remark, nick_name, alias, big_head_url FROM contact WHERE username IN (${placeholders})`,
            batch
          )

          if (contactRes.success && contactRes.rows) {
            for (const r of contactRes.rows) {
              const uname = r.username
              const name = r.remark || r.nick_name || r.alias || uname
              allBizAccounts[uname] = {
                username: uname,
                name: name,
                avatar: r.big_head_url,
                type: 3,
                last_time: Math.max(allBizAccounts[uname]?.last_time || 0, bizLatestTime[uname] || 0),
                formatted_last_time: ''
              }
            }
          }

          const bizInfoRes = await wcdbService.execQuery('biz', contactDbPath,
            `SELECT username, type FROM biz_info WHERE username IN (${placeholders})`,
            batch
          )
          if (bizInfoRes.success && bizInfoRes.rows) {
            for (const r of bizInfoRes.rows) {
              if (allBizAccounts[r.username]) {
                allBizAccounts[r.username].type = r.type
              }
            }
          }
        }
      }
    }

    const result = Object.values(allBizAccounts).map(acc => ({
      ...acc,
      formatted_last_time: acc.last_time ? new Date(acc.last_time * 1000).toISOString().split('T')[0] : ''
    })).sort((a, b) => {
      // 微信支付强制置顶
      if (a.username === 'gh_3dfda90e39d6') return -1
      if (b.username === 'gh_3dfda90e39d6') return 1
      return b.last_time - a.last_time
    })

    return result
  }

  private async getMsgContentBuf(messageContent: any): Promise<Buffer | null> {
    if (typeof messageContent === 'string') {
      if (messageContent.length > 0 && /^[0-9a-fA-F]+$/.test(messageContent)) {
        return Buffer.from(messageContent, 'hex')
      }
      return Buffer.from(messageContent, 'utf-8')
    } else if (messageContent && messageContent.data) {
      return Buffer.from(messageContent.data)
    } else if (Buffer.isBuffer(messageContent) || messageContent instanceof Uint8Array) {
      return Buffer.from(messageContent)
    }
    return null
  }

  async listMessages(username: string, account?: string, limit: number = 20, offset: number = 0): Promise<BizMessage[]> {
    const accountDir = this.getAccountDir(account)
    const md5Id = createHash('md5').update(username).digest('hex').toLowerCase()
    const tableName = `Msg_${md5Id}`
    const dbDir = join(accountDir, 'db_storage')

    if (!existsSync(dbDir)) return []
    const files = readdirSync(dbDir).filter(f => f.startsWith('biz_message') && f.endsWith('.db'))
    let targetDb: string | null = null

    for (const file of files) {
      const dbPath = join(dbDir, file)
      const checkRes = await wcdbService.execQuery('biz', dbPath, `SELECT name FROM sqlite_master WHERE type='table' AND lower(name)='${tableName}'`)
      if (checkRes.success && checkRes.rows && checkRes.rows.length > 0) {
        targetDb = dbPath
        break
      }
    }

    if (!targetDb) return []

    const msgRes = await wcdbService.execQuery('biz', targetDb, 
      `SELECT local_id, create_time, message_content FROM ${tableName} WHERE local_type != 1 ORDER BY create_time DESC LIMIT ${limit} OFFSET ${offset}`
    )

    const messages: BizMessage[] = []
    if (msgRes.success && msgRes.rows) {
      for (const row of msgRes.rows) {
        const contentBuf = await this.getMsgContentBuf(row.message_content)
        if (!contentBuf) continue

        const xmlStr = this.decompressZstd(contentBuf)
        const structData = this.parseBizXml(xmlStr)
        if (structData) {
          messages.push({
            local_id: row.local_id,
            create_time: row.create_time,
            ...structData
          })
        }
      }
    }

    return messages
  }

  async listPayRecords(account?: string, limit: number = 20, offset: number = 0): Promise<BizPayRecord[]> {
    const username = 'gh_3dfda90e39d6' // 硬编码的微信支付账号
    const accountDir = this.getAccountDir(account)
    const md5Id = createHash('md5').update(username).digest('hex').toLowerCase()
    const tableName = `Msg_${md5Id}`
    const dbDir = join(accountDir, 'db_storage')

    if (!existsSync(dbDir)) return []
    const files = readdirSync(dbDir).filter(f => f.startsWith('biz_message') && f.endsWith('.db'))
    let targetDb: string | null = null

    for (const file of files) {
      const dbPath = join(dbDir, file)
      const checkRes = await wcdbService.execQuery('biz', dbPath, `SELECT name FROM sqlite_master WHERE type='table' AND lower(name)='${tableName}'`)
      if (checkRes.success && checkRes.rows && checkRes.rows.length > 0) {
        targetDb = dbPath
        break
      }
    }

    if (!targetDb) return []

    const msgRes = await wcdbService.execQuery('biz', targetDb, 
      `SELECT local_id, create_time, message_content FROM ${tableName} WHERE local_type = 21474836529 OR local_type != 1 ORDER BY create_time DESC LIMIT ${limit} OFFSET ${offset}`
    )

    const records: BizPayRecord[] = []
    if (msgRes.success && msgRes.rows) {
      for (const row of msgRes.rows) {
        const contentBuf = await this.getMsgContentBuf(row.message_content)
        if (!contentBuf) continue

        const xmlStr = this.decompressZstd(contentBuf)
        const parsedData = this.parsePayXml(xmlStr)
        if (parsedData) {
          const timestamp = parsedData.timestamp || row.create_time
          records.push({
            local_id: row.local_id,
            create_time: row.create_time,
            ...parsedData,
            timestamp,
            formatted_time: new Date(timestamp * 1000).toLocaleString()
          })
        }
      }
    }

    return records
  }

  registerHandlers() {
    ipcMain.handle('biz:listAccounts', (_, account) => this.listAccounts(account))
    ipcMain.handle('biz:listMessages', (_, username, account, limit, offset) => this.listMessages(username, account, limit, offset))
    ipcMain.handle('biz:listPayRecords', (_, account, limit, offset) => this.listPayRecords(account, limit, offset))
  }
}

export const bizService = new BizService()
