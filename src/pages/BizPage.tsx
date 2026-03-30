import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useThemeStore } from '../stores/themeStore';
import { useAppStore } from '../stores/appStore';
import { ChevronLeft, Newspaper } from 'lucide-react';
import './BizPage.scss';

export interface BizAccount {
  username: string;
  name: string;
  avatar: string;
  type: number;
  last_time: number;
  formatted_last_time: string;
}

export const BizAccountList: React.FC<{
  onSelect: (account: BizAccount) => void;
  selectedUsername?: string;
  searchKeyword?: string;
}> = ({ onSelect, selectedUsername, searchKeyword }) => {
  const [accounts, setAccounts] = useState<BizAccount[]>([]);
  const [loading, setLoading] = useState(false);

  const [myWxid, setMyWxid] = useState<string>('');

  useEffect(() => {
    const initWxid = async () => {
      try {
        const wxid = await window.electronAPI.config.get('myWxid');
        if (wxid) {
          setMyWxid(wxid as string);
        }
      } catch (e) {
        console.error("获取 myWxid 失败:", e);
      }
    };
    initWxid();
  }, []);

  useEffect(() => {
    const fetch = async () => {
      if (!myWxid) {
        return;
      }

      setLoading(true);
      try {
        const res = await window.electronAPI.biz.listAccounts(myWxid)
        setAccounts(res || []);
      } catch (err) {
        console.error('获取服务号列表失败:', err);
      } finally {
        setLoading(false);
      }
    };
    fetch();
  }, [myWxid]);

  const filtered = useMemo(() => {
    if (!searchKeyword) return accounts;
    const q = searchKeyword.toLowerCase();
    return accounts.filter(a =>
      (a.name && a.name.toLowerCase().includes(q)) ||
      (a.username && a.username.toLowerCase().includes(q))
    );
  }, [accounts, searchKeyword]);

  if (loading) return <div className="biz-loading">加载中...</div>;

  return (
    <div className="biz-account-list">
      {filtered.map(item => (
        <div
          key={item.username}
          onClick={() => onSelect(item)}
          className={`biz-account-item ${selectedUsername === item.username ? 'active' : ''} ${item.username === 'gh_3dfda90e39d6' ? 'pay-account' : ''}`}
        >
          <img 
            src={item.avatar || 'https://res.wx.qq.com/a/wx_fed/assets/res/NTI4MWU5.png'} 
            className="biz-avatar"
            alt=""
          />
          <div className="biz-info">
            <div className="biz-info-top">
              <span className="biz-name">{item.name || item.username}</span>
              <span className="biz-time">{item.formatted_last_time}</span>
            </div>
            <div className={`biz-badge ${
              item.type === 1 ? 'type-service' : 
              item.type === 0 ? 'type-sub' : 
              item.type === 2 ? 'type-enterprise' : 'type-unknown'
            }`}>
              {item.type === 1 ? '服务号' : item.type === 0 ? '订阅号' : item.type === 2 ? '企业号' : '未知'}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};

// 2. 公众号消息区域组件 (展示在右侧消息区)
export const BizMessageArea: React.FC<{
  account: BizAccount | null;
}> = ({ account }) => {
  const themeMode = useThemeStore((state) => state.themeMode);
  const [messages, setMessages] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const limit = 20;
  const messageListRef = useRef<HTMLDivElement>(null);
  const myWxid = useAppStore((state) => state.myWxid);

  const isDark = useMemo(() => {
    if (themeMode === 'dark') return true;
    if (themeMode === 'system') {
      return window.matchMedia('(prefers-color-scheme: dark)').matches;
    }
    return false;
  }, [themeMode]);

  useEffect(() => {
    if (account) {
      setMessages([]);
      setOffset(0);
      setHasMore(true);
      loadMessages(account.username, 0);
    }
  }, [account]);

  const loadMessages = async (username: string, currentOffset: number) => {
    if (loading || !myWxid) return; // 没账号直接 return

    setLoading(true);
    try {
      let res;
      if (username === 'gh_3dfda90e39d6') {
        // 传入 myWxid
        res = await window.electronAPI.biz.listPayRecords(myWxid, limit, currentOffset);
      } else {
        // 传入 myWxid，替换掉 undefined
        res = await window.electronAPI.biz.listMessages(username, myWxid, limit, currentOffset);
      }
      if (res) {
        if (res.length < limit) setHasMore(false);
        setMessages(prev => currentOffset === 0 ? res : [...prev, ...res]);
        setOffset(currentOffset + limit);
      }
    } catch (err) {
      console.error('加载消息失败:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const target = e.currentTarget;
    if (target.scrollHeight - Math.abs(target.scrollTop) - target.clientHeight < 50) {
      if (!loading && hasMore && account) {
        loadMessages(account.username, offset);
      }
    }
  };

  if (!account) {
    return (
      <div className="biz-empty-state">
        <div className="empty-icon"><Newspaper size={40} /></div>
        <p>请选择一个服务号查看消息</p>
      </div>
    );
  }

  const defaultImage = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0MDAiIGhlaWdodD0iMTgwIj48cmVjdCB3aWR0aD0iNDAwIiBoZWlnaHQ9IjE4MCIgZmlsbD0iI2Y1ZjVmNSIvPjwvc3ZnPg==';

  return (
    <div className={`biz-main ${isDark ? 'dark' : ''}`}>
      <div className="main-header">
        <h2>{account.name}</h2>
      </div>
      <div className="message-container" onScroll={handleScroll} ref={messageListRef}>
        <div className="messages-wrapper">
          {messages.map((msg) => (
            <div key={msg.local_id}>
              {account.username === 'gh_3dfda90e39d6' ? (
                <div className="pay-card">
                  <div className="pay-header">
                    {msg.merchant_icon ? <img src={msg.merchant_icon} className="pay-icon" alt=""/> : <div className="pay-icon placeholder">¥</div>}
                    <span>{msg.merchant_name || '微信支付'}</span>
                  </div>
                  <div className="pay-title">{msg.title}</div>
                  <div className="pay-desc">{msg.description}</div>
                  <div className="pay-footer">{msg.formatted_time}</div>
                </div>
              ) : (
                <div className="article-card">
                  <div onClick={() => window.electronAPI.shell.openExternal(msg.url)} className="main-article">
                    <img src={msg.cover || defaultImage} className="article-cover" alt=""/>
                    <div className="article-overlay"><h3 className="article-title">{msg.title}</h3></div>
                  </div>
                  {msg.des && <div className="article-digest">{msg.des}</div>}
                  {msg.content_list && msg.content_list.length > 0 && (
                    <div className="sub-articles">
                      {msg.content_list.map((item: any, idx: number) => (
                        <div key={idx} onClick={() => window.electronAPI.shell.openExternal(item.url)} className="sub-item">
                          <span className="sub-title">{item.title}</span>
                          {item.cover && <img src={item.cover} className="sub-cover" alt=""/>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
          {loading && <div className="biz-loading-more">加载中...</div>}
        </div>
      </div>
    </div>
  );
};

// 保持 BizPage 作为入口 (如果需要独立页面)
const BizPage: React.FC = () => {
  const [selectedAccount, setSelectedAccount] = useState<BizAccount | null>(null);
  return (
    <div className="biz-page">
      <div className="biz-sidebar">
        <BizAccountList onSelect={setSelectedAccount} selectedUsername={selectedAccount?.username} />
      </div>
      <BizMessageArea account={selectedAccount} />
    </div>
  );
}

export default BizPage;
