import "./App.css";
import io from "socket.io-client";
import Peer from "peerjs"; 
import { useState, useEffect, useRef } from "react";
import toast, { Toaster } from 'react-hot-toast'; 
import EmojiPicker from 'emoji-picker-react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';

const SERVER_URL = "http://81.106.250.70:3000"; 
const PEER_CONFIG = { host: "81.106.250.70", port: 3002, path: "/cranix", secure: false };
const ipcRenderer = window.require ? window.require('electron').ipcRenderer : null;
let socket;

// --- IDLE TIMER HOOK ---
const useIdleTimer = (onIdle, timeout = 600000) => { // 10 mins
    const timer = useRef(null);
    useEffect(() => {
        const reset = () => { clearTimeout(timer.current); timer.current = setTimeout(onIdle, timeout); };
        window.addEventListener('mousemove', reset); window.addEventListener('keypress', reset);
        reset();
        return () => { window.removeEventListener('mousemove', reset); window.removeEventListener('keypress', reset); clearTimeout(timer.current); };
    }, [onIdle, timeout]);
};

// --- HELPER: Compress Image ---
const compressImage = (file) => {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = (e) => {
            const img = new Image();
            img.src = e.target.result;
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const scale = 800 / img.width;
                canvas.width = 800; canvas.height = img.height * scale;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                resolve(canvas.toDataURL('image/jpeg', 0.7));
            }
        }
    });
};

function App() {
  // --- STATE ---
  const [currentApp, setCurrentApp] = useState("chat"); // 'chat', 'media', 'settings'
  const [isLocked, setIsLocked] = useState(false);
  const [unlockPass, setUnlockPass] = useState("");

  // Auth
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [myAvatar, setMyAvatar] = useState("");
  const [myBio, setMyBio] = useState("");
  const [myStatus, setMyStatus] = useState("online");
  const [themeColor, setThemeColor] = useState("#0055FF");

  // Data
  const [friends, setFriends] = useState([]);
  const [groups, setGroups] = useState([]);
  const [requests, setRequests] = useState([]);
  const [onlineUsers, setOnlineUsers] = useState([]);

  // Chat
  const [room, setRoom] = useState("");
  const [isGroupRoom, setIsGroupRoom] = useState(false);
  const [messageList, setMessageList] = useState([]);
  const [currentMessage, setCurrentMessage] = useState("");
  const [mediaGallery, setMediaGallery] = useState([]);
  const [typingUser, setTypingUser] = useState("");

  // UI
  const [contextMenu, setContextMenu] = useState({ visible: false, x: 0, y: 0, msg: null });
  const [showEmoji, setShowEmoji] = useState(false);
  const [showAddFriend, setShowAddFriend] = useState(false);
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [groupNameInput, setGroupNameInput] = useState("");
  const [selectedGroupMembers, setSelectedGroupMembers] = useState([]);
  const [replyTo, setReplyTo] = useState(null);

  // Voice
  const [isInCall, setIsInCall] = useState(false);
  const [incomingCall, setIncomingCall] = useState(null);
  const [remoteStreamObj, setRemoteStreamObj] = useState(null);

  // Refs
  const bottomRef = useRef(null);
  const typingTimeoutRef = useRef(null);
  const peerInstance = useRef(null);
  const myStreamRef = useRef(null);
  const remoteVideoRef = useRef(null);

  // --- IDLE CHECK ---
  useIdleTimer(() => { if(isLoggedIn) setIsLocked(true); }, 600000);

  // --- INIT ---
  useEffect(() => {
    const saved = localStorage.getItem("cranix_user");
    if (saved) {
      const u = JSON.parse(saved);
      setUsername(u.username); setMyAvatar(u.avatar);
      if(u.theme) { setThemeColor(u.theme); document.documentElement.style.setProperty('--cranix-blue', u.theme); }
      connectSocket(u.username); initializePeer(u.username);
      fetchFriends(u.username); fetchGroups(u.username); fetchRequests(u.username);
    }
  }, []);

  const connectSocket = (u) => {
    socket = io.connect(SERVER_URL);
    setIsLoggedIn(true);
    socket.emit("user_login", u);

    socket.on("receive_message", (data) => {
      setMessageList(prev => data.room === room ? [...prev, data] : prev);
      if(data.room !== room && data.author !== u) {
          const sound = data.message.includes(`@${u}`) ? '/mention.mp3' : '/pop.mp3';
          new Audio(sound).play().catch(()=>{});
          if(ipcRenderer && document.hidden) ipcRenderer.send('show-notification', { title: data.author, body: data.message });
      }
    });

    socket.on("reaction_updated", ({ messageId, reactions }) => {
        setMessageList(prev => prev.map(m => m._id === messageId ? { ...m, reactions } : m));
    });
    
    socket.on("load_history", setMessageList);
    socket.on("online_update", setOnlineUsers);
    socket.on("friend_update", () => { fetchFriends(u); fetchRequests(u); });
    socket.on("group_update", () => fetchGroups(u));
    socket.on("display_typing", (d) => setTypingUser(`${d.author} is typing...`));
    socket.on("hide_typing", () => setTypingUser(""));
    socket.on("message_deleted", ({id}) => setMessageList(prev => prev.filter(m => m._id !== id)));
  };

  // --- API ---
  const handleLogin = async () => {
      try {
        const res = await fetch(`${SERVER_URL}/login`, { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({username,password})});
        const data = await res.json();
        if(res.ok) {
            setIsLoggedIn(true); setMyAvatar(data.avatar);
            if(data.theme) { setThemeColor(data.theme); document.documentElement.style.setProperty('--cranix-blue', data.theme); }
            localStorage.setItem("cranix_user", JSON.stringify({username, avatar: data.avatar, theme: data.theme}));
            connectSocket(username); initializePeer(username);
            fetchFriends(username); fetchGroups(username); fetchRequests(username);
        } else toast.error(data.error);
      } catch(e) { toast.error("Server Down"); }
  };

  const updateProfile = async (newTheme) => {
      const payload = { username, bio: myBio, status: myStatus };
      if(newTheme) { payload.theme = newTheme; setThemeColor(newTheme); document.documentElement.style.setProperty('--cranix-blue', newTheme); }
      await fetch(`${SERVER_URL}/update-profile`, { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify(payload)});
      toast.success("Saved");
      let u = JSON.parse(localStorage.getItem("cranix_user"));
      if(newTheme) u.theme = newTheme;
      localStorage.setItem("cranix_user", JSON.stringify(u));
  };

  const fetchFriends = async(u) => { const res = await fetch(`${SERVER_URL}/friends/${u}`); setFriends(await res.json()); }
  const fetchGroups = async(u) => { const res = await fetch(`${SERVER_URL}/groups/${u}`); setGroups(await res.json()); }
  const fetchRequests = async(u) => { const res = await fetch(`${SERVER_URL}/requests/${u}`); setRequests(await res.json()); }
  
  const createGroup = async() => {
      if(!groupNameInput) return;
      const members = [...selectedGroupMembers, username];
      await fetch(`${SERVER_URL}/create-group`, { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ name:groupNameInput, members, admin:username})});
      setShowCreateGroup(false); setGroupNameInput(""); setSelectedGroupMembers([]);
      toast.success("Group Created");
  };

  const fetchMedia = async() => { if(room) { const res = await fetch(`${SERVER_URL}/media/${room}`); setMediaGallery(await res.json()); }};

  // --- CHAT LOGIC ---
  const startChat = (target, isGroup) => {
      let newRoom = isGroup ? target._id : [username, target].sort().join("_");
      setRoom(newRoom); setIsGroupRoom(isGroup); setMessageList([]);
      socket.emit("join_channel", newRoom);
  };

  const sendMessage = async () => {
      if(!currentMessage && !replyTo) return;
      
      // Slash Commands
      if(currentMessage.startsWith("/clear")) { setMessageList([]); setCurrentMessage(""); return; }
      if(currentMessage.startsWith("/shrug")) { socket.emit("send_message", { room, author: username, message: "¯\\_(ツ)_/¯", time: "Now" }); setCurrentMessage(""); return; }

      const msg = { 
          room, author: username, message: currentMessage, 
          time: new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}),
          replyTo: replyTo ? { author: replyTo.author, message: replyTo.message } : null 
      };
      await socket.emit("send_message", msg);
      socket.emit("stop_typing", { room });
      setCurrentMessage(""); setReplyTo(null); setShowEmoji(false);
  };

  const handleFileUpload = async (file) => {
      if(file && file.type.startsWith("image/")) {
          const compressed = await compressImage(file);
          socket.emit("send_message", { room, author: username, message: "", image: compressed, time: "Now" });
      }
  };

  const addReaction = (emoji) => {
      socket.emit("add_reaction", { messageId: contextMenu.msg._id, emoji, username, room });
      setContextMenu({ ...contextMenu, visible: false });
  };

  // --- VOICE LOGIC ---
  const initializePeer = (u) => {
      const peer = new Peer(u, PEER_CONFIG);
      peer.on('call', (call) => setIncomingCall({ caller: call.peer, callObj: call }));
      peerInstance.current = peer;
  };
  const startCall = async (video) => {
      if(isGroupRoom) return toast.error("1-on-1 only");
      const friend = room.replace(username, "").replace("_", "");
      try {
          const stream = video ? await navigator.mediaDevices.getDisplayMedia({video:true,audio:true}) : await navigator.mediaDevices.getUserMedia({audio:true});
          myStreamRef.current = stream;
          const call = peerInstance.current.call(friend, stream);
          setIsInCall(true);
          call.on('stream', (rs) => { setRemoteStreamObj(rs); if(remoteVideoRef.current) remoteVideoRef.current.srcObject = rs; });
          call.on('close', endCall);
      } catch(e) { toast.error("Call Failed"); }
  };
  const answerCall = async () => {
      const stream = await navigator.mediaDevices.getUserMedia({audio:true});
      incomingCall.callObj.answer(stream);
      setIsInCall(true); setIncomingCall(null);
      incomingCall.callObj.on('stream', (rs) => { setRemoteStreamObj(rs); if(remoteVideoRef.current) remoteVideoRef.current.srcObject = rs; });
  };
  const endCall = () => { if(myStreamRef.current) myStreamRef.current.getTracks().forEach(t=>t.stop()); setIsInCall(false); setRemoteStreamObj(null); };

  // --- RENDER HELPERS ---
  const formatText = (text) => {
      if(!text) return "";
      const parts = text.split(/(\|\|.*?\|\||`[^`]+`|```[\s\S]*?```)/g);
      return parts.map((part, i) => {
          if(part.startsWith("||") && part.endsWith("||")) return <span key={i} className="spoiler" onClick={(e)=>e.target.classList.add('revealed')}>{part.slice(2,-2)}</span>;
          if(part.startsWith("```")) return <SyntaxHighlighter key={i} language="javascript" style={vscDarkPlus}>{part.slice(3,-3)}</SyntaxHighlighter>;
          if(part.startsWith("`")) return <span key={i} className="code-inline">{part.slice(1,-1)}</span>;
          if(part.includes(`@${username}`)) return <span key={i} className="mention">{part}</span>;
          return part;
      });
  };

  // --- AUTO SCROLL ---
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messageList]);

  // --- APP LOCK VIEW ---
  if(isLocked) return (
      <div className="app-lock">
          <div className="lock-content">
              <h1>TERMINAL LOCKED</h1>
              <input type="password" placeholder="PASSWORD" value={unlockPass} onChange={e=>setUnlockPass(e.target.value)} />
              <button onClick={()=>{ if(unlockPass===password) {setIsLocked(false); setUnlockPass("");} else toast.error("ACCESS DENIED"); }}>UNLOCK</button>
          </div>
      </div>
  );

  if(!isLoggedIn) return (
      <div className="joinChatContainer">
          <div className="ios-icon"><div className="inner-icon">C1</div></div>
          <h3>CranixOne</h3>
          <input onChange={e=>setUsername(e.target.value)} placeholder="Username"/>
          <input type="password" onChange={e=>setPassword(e.target.value)} placeholder="Password"/>
          <button onClick={handleLogin}>Log In</button>
          <div className="switch-auth">Secure Terminal Access</div>
      </div>
  );

  return (
    <div className="App">
      <Toaster position="top-center" toastOptions={{style:{background:'#222', color:'#fff', border:'1px solid #444'}}} />

      {/* VIDEO OVERLAY */}
      <div className={`video-container ${isInCall && remoteStreamObj?.getVideoTracks().length > 0 ? 'visible' : ''}`}>
           <video ref={remoteVideoRef} autoPlay playsInline />
           <button onClick={endCall} className="video-hangup">End Stream</button>
      </div>
      <audio ref={remoteVideoRef} autoPlay style={{display: remoteStreamObj?.getVideoTracks().length ? 'none' : 'block'}} />

      {/* CALL MODAL */}
      {incomingCall && !isInCall && (
          <div className="modal-overlay">
              <div className="modal-box center">
                  <h3>Incoming Call: {incomingCall.caller}</h3>
                  <button onClick={answerCall} className="btn-green">Answer</button>
                  <button onClick={()=>{incomingCall.callObj.close(); setIncomingCall(null);}} className="btn-red">Decline</button>
              </div>
          </div>
      )}

      {/* ADD GROUP MODAL */}
      {showCreateGroup && (
           <div className="modal-overlay">
               <div className="modal-box">
                   <h3>New Channel</h3>
                   <input placeholder="Name" value={groupNameInput} onChange={e=>setGroupNameInput(e.target.value)} />
                   <div className="member-select-list">
                       {friends.map(f => (
                           <div key={f._id} className={`select-item ${selectedGroupMembers.includes(f.username)?'selected':''}`} 
                                onClick={()=>{ if(selectedGroupMembers.includes(f.username)) setSelectedGroupMembers(p=>p.filter(x=>x!==f.username)); else setSelectedGroupMembers(p=>[...p,f.username]); }}>
                               {f.username}
                           </div>
                       ))}
                   </div>
                   <button onClick={createGroup}>Create</button>
                   <button className="close-btn" onClick={()=>setShowCreateGroup(false)}>Cancel</button>
               </div>
           </div>
      )}
      {/* ADD FRIEND MODAL */}
      {showAddFriend && (
          <div className="modal-overlay">
              <div className="modal-box">
                  <h3>Add User</h3>
                  <input id="friendIn" placeholder="Username" />
                  <button onClick={async()=>{
                      const v = document.getElementById("friendIn").value;
                      const res = await fetch(`${SERVER_URL}/add-friend`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({sender:username, receiver:v})});
                      const d=await res.json(); res.ok?toast.success("Sent"):toast.error(d.error); setShowAddFriend(false);
                  }}>Send Request</button>
                  {requests.map(r=><div key={r._id} className="req-item">{r.sender} <button onClick={async()=>{await fetch(`${SERVER_URL}/accept-friend`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({requestId:r._id})}); fetchFriends(username); fetchRequests(username);}}>Accept</button></div>)}
                  <button className="close-btn" onClick={()=>setShowAddFriend(false)}>Close</button>
              </div>
          </div>
      )}

      {/* CONTEXT MENU */}
      {contextMenu.visible && (
          <div className="context-menu" style={{top:contextMenu.y, left:contextMenu.x}}>
              <div onClick={()=>addReaction('👍')}>👍 Like</div>
              <div onClick={()=>addReaction('😂')}>😂 Laugh</div>
              <div onClick={()=>addReaction('❤️')}>❤️ Love</div>
              <div className="separator"></div>
              <div onClick={()=>{setReplyTo(contextMenu.msg); setContextMenu({visible:false,x:0,y:0})}}>↩ Reply</div>
              {contextMenu.msg.author === username && <div className="danger" onClick={()=>{socket.emit("delete_message",{id:contextMenu.msg._id, room}); setContextMenu({visible:false,x:0,y:0})}}>Delete</div>}
          </div>
      )}

      {/* APP DOCK */}
      <div className="app-dock">
          <div className={`dock-item ${currentApp==='chat'?'active':''}`} onClick={()=>setCurrentApp('chat')}>💬</div>
          <div className={`dock-item ${currentApp==='media'?'active':''}`} onClick={()=>{setCurrentApp('media'); fetchMedia();}}>🖼️</div>
          <div className="dock-spacer"></div>
          <div className={`dock-item ${currentApp==='settings'?'active':''}`} onClick={()=>setCurrentApp('settings')}>⚙️</div>
      </div>

      {/* MAIN STAGE */}
      <div className="main-stage">
          
          {/* SETTINGS VIEW */}
          {currentApp === 'settings' && (
              <div className="settings-page">
                  <h2>Configuration</h2>
                  <div className="setting-block">
                      <label>Theme Color</label>
                      <div className="theme-grid">
                          {['#0055FF', '#22c55e', '#ef4444', '#a855f7', '#f97316'].map(c => (
                              <div key={c} className="theme-swatch" style={{background:c}} onClick={()=>updateProfile(c)}></div>
                          ))}
                      </div>
                  </div>
                  <div className="setting-block">
                      <label>Status</label>
                      <select value={myStatus} onChange={e=>{setMyStatus(e.target.value); updateProfile();}} className="settings-input">
                          <option value="online">Online</option><option value="idle">Idle</option><option value="dnd">Do Not Disturb</option>
                      </select>
                  </div>
                  <div className="setting-block">
                      <label>Bio</label>
                      <textarea className="settings-input" value={myBio} onChange={e=>setMyBio(e.target.value)} onBlur={()=>updateProfile()} />
                  </div>
                  <button className="logout-btn" onClick={()=>{localStorage.removeItem("cranix_user"); window.location.reload();}}>Log Out</button>
              </div>
          )}

          {/* MEDIA GALLERY VIEW */}
          {currentApp === 'media' && (
              <div className="media-gallery-page">
                  <h2>Gallery {room && ` - ${room}`}</h2>
                  <div className="gallery-grid">
                      {mediaGallery.map((m,i)=><div key={i} className="gallery-item"><img src={m.image} alt=""/></div>)}
                  </div>
              </div>
          )}

          {/* CHAT VIEW */}
          {currentApp === 'chat' && (
              <div className="chat-window-wrapper">
                  <div className="sidebar">
                       <div className="sidebar-icon home-icon">{myAvatar?<img src={myAvatar} className="sidebar-avatar-img" alt=""/>:username[0]}<div className={`status-dot ${myStatus}`}></div></div>
                       <div className="separator"></div>
                       <div className="sidebar-header">CHANNELS <button onClick={()=>setShowCreateGroup(true)}>+</button></div>
                       {groups.map(g=><div key={g._id} className="sidebar-icon group-icon" onClick={()=>startChat(g,true)}>{g.name[0]}</div>)}
                       <div className="sidebar-header">DIRECT</div>
                       {friends.map(f=>{
                           const onlineData = onlineUsers.find(u=>u[0]===f.username);
                           const st = onlineData ? onlineData[1] : 'gray';
                           return (
                               <div key={f._id} className="sidebar-icon" onClick={()=>startChat(f.username,false)}>
                                   {f.avatar?<img src={f.avatar} className="sidebar-avatar-img" alt=""/>:f.username[0]}
                                   <div className="online-dot-sidebar" style={{background:st==='online'?'#22c55e':st==='dnd'?'#ef4444':st==='idle'?'#eab308':'#555'}}></div>
                               </div>
                           )
                       })}
                       <div className="sidebar-icon add-btn" onClick={()=>setShowAddFriend(true)}>+</div>
                  </div>

                  <div className="chat-interface">
                      {room ? (
                          <>
                            <div className="dynamic-island-container">
                                <div className="dynamic-island">
                                    <p>@{isGroupRoom ? groups.find(g=>g._id===room)?.name : room.replace(username,"").replace("_","")}</p>
                                    {!isGroupRoom && (
                                        <div className="call-controls">
                                            <button className="call-btn" onClick={()=>startCall(false)}>📞</button>
                                            <button className="call-btn" onClick={()=>startCall(true)}>🖥️</button>
                                        </div>
                                    )}
                                </div>
                            </div>
                            
                            <div className="chat-body">
                                {messageList.map((msg, i) => (
                                    <div key={i} className="message-row" onContextMenu={(e)=>{e.preventDefault(); setContextMenu({visible:true, x:e.pageX, y:e.pageY, msg})}}>
                                        <div className="avatar">{msg.author[0]}</div>
                                        <div className="message-data">
                                            <div className="message-info"><span className="username">{msg.author}</span> <span className="timestamp">{msg.time}</span></div>
                                            {msg.replyTo && <div className="reply-preview">Replying to {msg.replyTo.author}</div>}
                                            <div className="message-text">
                                                {msg.image ? <img src={msg.image} className="chat-image" alt=""/> : formatText(msg.message)}
                                            </div>
                                            {msg.reactions?.length > 0 && (
                                                <div className="reactions-row">{msg.reactions.map(r=><span key={r.emoji} className="reaction-pill">{r.emoji} {r.count}</span>)}</div>
                                            )}
                                        </div>
                                    </div>
                                ))}
                                {typingUser && <div className="typing-indicator">{typingUser}</div>}
                                <div ref={bottomRef} />
                            </div>

                            <div className="chat-footer">
                                {replyTo && <div className="reply-bar">Replying to {replyTo.author} <button onClick={()=>setReplyTo(null)}>X</button></div>}
                                <div className="input-capsule">
                                    <button onClick={()=>setShowEmoji(!showEmoji)}>😊</button>
                                    {showEmoji && <div className="emoji-popover"><EmojiPicker theme="dark" onEmojiClick={(e)=>{setCurrentMessage(p=>p+e.emoji); setShowEmoji(false);}}/></div>}
                                    <input type="file" id="fi" hidden onChange={e=>handleFileUpload(e.target.files[0])} />
                                    <button onClick={()=>document.getElementById("fi").click()}>📎</button>
                                    <input value={currentMessage} onChange={e=>{setCurrentMessage(e.target.value); socket.emit("typing",{room,author:username}); clearTimeout(typingTimeoutRef.current); typingTimeoutRef.current=setTimeout(()=>socket.emit("stop_typing",{room}),2000);}} onKeyPress={e=>e.key==='Enter'&&sendMessage()} placeholder="Message..." />
                                </div>
                            </div>
                          </>
                      ) : <div className="empty-state"><h3>Select a Channel</h3></div>}
                  </div>
              </div>
          )}
      </div>
    </div>
  );
}

export default App;