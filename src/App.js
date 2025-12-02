import "./App.css";
import io from "socket.io-client";
import Peer from "peerjs"; 
import { useState, useEffect, useRef } from "react";

// SERVER CONFIG
const SERVER_URL = "http://ix.nickyboi.com:3000";
const PEER_CONFIG = {
  host: "81.96.163.137", 
  port: 3002,
  path: "/cranix",
  secure: false,
};

// Electron IPC (Require securely)
const ipcRenderer = window.require ? window.require('electron').ipcRenderer : null;

let socket;

function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [isRegistering, setIsRegistering] = useState(false);
  const [authError, setAuthError] = useState("");
  
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [myAvatar, setMyAvatar] = useState("");
  
  const [room, setRoom] = useState(""); 
  const [currentMessage, setCurrentMessage] = useState("");
  const [messageList, setMessageList] = useState([]);
  const [typingUser, setTypingUser] = useState(""); 
  
  const [friends, setFriends] = useState([]);
  const [onlineUsers, setOnlineUsers] = useState([]);
  const [requests, setRequests] = useState([]);
  const [showAddFriend, setShowAddFriend] = useState(false);
  const [friendInput, setFriendInput] = useState("");
  const [showSettings, setShowSettings] = useState(false);

  // VOICE CHAT STATE
  const [incomingCall, setIncomingCall] = useState(null);
  const [isInCall, setIsInCall] = useState(false);
  const [isMuted, setIsMuted] = useState(false);

  // UPDATER STATE
  const [updateStatus, setUpdateStatus] = useState("");
  
  // REFS
  const bottomRef = useRef(null);
  const typingTimeoutRef = useRef(null); 
  const peerInstance = useRef(null);
  const myStreamRef = useRef(null);
  const remoteAudioRef = useRef(null);

  // --- AUTO LOGIN, UPDATER & CLEANUP ---
  useEffect(() => {
    // 1. Check LocalStorage
    const savedUser = localStorage.getItem("cranix_user");
    if (savedUser) {
      const userObj = JSON.parse(savedUser);
      setUsername(userObj.username);
      setMyAvatar(userObj.avatar || "");
      connectSocket(userObj.username);
      initializePeer(userObj.username);
      fetchFriends(userObj.username);
      fetchRequests(userObj.username);
    }

    // 2. Setup Auto Updater Listener
    if (ipcRenderer) {
      ipcRenderer.on('updater_message', (event, data) => {
        console.log("Updater Event:", data);
        switch (data.status) {
          case 'checking':
            setUpdateStatus("Checking for updates...");
            break;
          case 'available':
            setUpdateStatus("Update found. Downloading...");
            break;
          case 'no_update':
            // setUpdateStatus("You are up to date.");
            setTimeout(() => setUpdateStatus(""), 3000);
            break;
          case 'downloading':
            setUpdateStatus(`Downloading Update: ${Math.round(data.progress)}%`);
            break;
          case 'downloaded':
            setUpdateStatus("Update downloaded. Restarting in 4 seconds...");
            break;
          case 'error':
            setUpdateStatus(`Update Error: ${data.info}`);
            break;
          default:
            break;
        }
      });
    }

    return () => {
      if (peerInstance.current) peerInstance.current.destroy();
      if (socket) socket.disconnect();
      if (ipcRenderer) ipcRenderer.removeAllListeners('updater_message');
    };
  }, []);

  // --- AUTH ---
  const handleLogin = async () => {
    try {
      const res = await fetch(`${SERVER_URL}/login`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (res.ok) {
        const avatar = data.avatar || "";
        setMyAvatar(avatar);
        localStorage.setItem("cranix_user", JSON.stringify({ username, avatar }));
        
        connectSocket(username);
        initializePeer(username);
        fetchFriends(username);
        fetchRequests(username);
      } else { setAuthError(data.error); }
    } catch (err) { setAuthError("Server unavailable"); }
  };

  const handleRegister = async () => {
    try {
      const res = await fetch(`${SERVER_URL}/register`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (res.ok) { setAuthError(""); setIsRegistering(false); alert("Account created! Please log in."); } 
      else { setAuthError(data.error); }
    } catch (err) { setAuthError("Registration failed"); }
  };

  const handleLogout = () => {
    if (peerInstance.current) peerInstance.current.destroy();
    localStorage.removeItem("cranix_user");
    window.location.reload();
  };

  const connectSocket = (user) => {
    socket = io.connect(SERVER_URL);
    setIsLoggedIn(true);
    socket.emit("user_login", user);
    setupSocketListeners(user);
  };

  // --- VOICE CHAT ---
  const initializePeer = (myUsername) => {
    if (peerInstance.current) peerInstance.current.destroy();

    const peer = new Peer(myUsername, PEER_CONFIG);
    
    peer.on('open', (id) => { console.log("Phone line active: " + id); });
    
    peer.on('error', (err) => {
      if (err.type === 'unavailable-id') {
        setTimeout(() => initializePeer(myUsername), 1000);
      } 
      else if (err.type === 'peer-unavailable') {
        sendSystemMessage("📞 Missed Call (User Offline)");
        endCall(); 
      }
    });

    peer.on('call', (call) => {
      setIncomingCall({ caller: call.peer, callObj: call });
    });

    peerInstance.current = peer;
  };

  const startCall = async () => {
    const friendName = room.replace(username, "").replace("_", "");
    
    if (!peerInstance.current || peerInstance.current.disconnected) {
      alert("Phone line disconnected. Reconnecting...");
      initializePeer(username);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      myStreamRef.current = stream;
      
      const call = peerInstance.current.call(friendName, stream);
      
      if (!call) {
        sendSystemMessage("📞 Missed Call (Connection Failed)");
        endCall();
        return;
      }

      setIsInCall(true);

      call.on('stream', (remoteStream) => {
        if (remoteAudioRef.current) {
          remoteAudioRef.current.srcObject = remoteStream;
          remoteAudioRef.current.play();
        }
      });
      call.on('close',endCall);
      call.on('error', () => { sendSystemMessage("📞 Call Failed"); endCall(); });
      
    } catch (err) { alert("Microphone error: " + err.message); }
  };

  const answerCall = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      myStreamRef.current = stream;
      incomingCall.callObj.answer(stream);
      setIsInCall(true);
      setIncomingCall(null);

      incomingCall.callObj.on('stream', (remoteStream) => {
        if (remoteAudioRef.current) {
          remoteAudioRef.current.srcObject = remoteStream;
          remoteAudioRef.current.play();
        }
      });
      incomingCall.callObj.on('close', endCall);
    } catch (err) { alert("Could not answer call."); }
  };

  const toggleMute = () => {
    if (myStreamRef.current) {
      const audioTrack = myStreamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsMuted(!audioTrack.enabled);
      }
    }
  };

  const endCall = () => {
    if (myStreamRef.current) {
      myStreamRef.current.getTracks().forEach(track => track.stop());
      myStreamRef.current = null;
    }
    if (remoteAudioRef.current) remoteAudioRef.current.srcObject = null;
    if (incomingCall && incomingCall.callObj) incomingCall.callObj.close();

    setIsInCall(false);
    setIncomingCall(null);
    setIsMuted(false);
  };

  // --- SOCKET LISTENERS ---
  const setupSocketListeners = (currentUser) => {
    socket.on("receive_message", (data) => {
      setMessageList((list) => [...list, data]);
      if (data.author !== currentUser && data.author !== "System") {
        new Audio('/pop.mp3').play().catch(e => {});
      }
    });
    socket.on("load_history", (history) => setMessageList(history));
    socket.on("display_typing", (data) => setTypingUser(`${data.author} is typing...`));
    socket.on("hide_typing", () => setTypingUser(""));
    socket.on("friend_update", () => { 
        fetchFriends(currentUser); 
        fetchRequests(currentUser); 
    });
    socket.on("online_update", (users) => { setOnlineUsers(users); });
  };

  // --- APP LOGIC ---
  
  const fetchFriends = async (user) => {
    try {
      const res = await fetch(`${SERVER_URL}/friends/${user}`);
      const data = await res.json();
      setFriends(data);
    } catch(e) { console.error("Error fetching friends"); }
  };

  const fetchRequests = async (user) => {
    try {
      const res = await fetch(`${SERVER_URL}/requests/${user}`);
      const data = await res.json();
      setRequests(data);
    } catch(e) {}
  };

  const sendFriendRequest = async () => {
    if(!friendInput) return;
    try {
      const res = await fetch(`${SERVER_URL}/add-friend`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sender: username, receiver: friendInput }),
      });
      const data = await res.json();
      
      if(res.ok) { 
        alert("Request Sent!"); 
        setFriendInput(""); 
        setShowAddFriend(false); 
      } else { 
        alert(data.error || "Failed to send request"); 
      }
    } catch(e) { alert("Network error"); }
  };

  const acceptRequest = async (requestId) => {
    await fetch(`${SERVER_URL}/accept-friend`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestId }),
    });
    fetchFriends(username);
    fetchRequests(username);
  };
  
  const handleProfileUpload = () => { document.getElementById("avatarInput").click(); };
  const onAvatarFileChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = async () => {
        const base64 = reader.result;
        setMyAvatar(base64);
        localStorage.setItem("cranix_user", JSON.stringify({ username, avatar: base64 }));
        await fetch(`${SERVER_URL}/upload-avatar`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username, image: base64 }),
        });
      };
      reader.readAsDataURL(file);
    }
  };

  const startChat = (friendName) => {
    const participants = [username, friendName].sort();
    const newRoom = participants.join("_");
    if (room === newRoom) return;
    setRoom(newRoom);
    setMessageList([]);
    socket.emit("join_channel", newRoom);
    setTypingUser("");
  };

  const sendSystemMessage = (text) => {
    if (!room) return; 
    const messageData = {
      room: room, author: "System", message: text, image: "",
      time: new Date().getHours() + ":" + String(new Date().getMinutes()).padStart(2, '0'),
    };
    socket.emit("send_message", messageData);
    setMessageList((list) => [...list, messageData]);
  };

  const sendMessage = async () => {
    if (currentMessage !== "") {
      const messageData = {
        room: room, author: username, message: currentMessage, image: "",
        time: new Date().getHours() + ":" + String(new Date().getMinutes()).padStart(2, '0'),
      };
      await socket.emit("send_message", messageData);
      socket.emit("stop_typing", { room }); 
      setMessageList((list) => [...list, messageData]);
      setCurrentMessage("");
    }
  };
  const getAvatarForUser = (user) => {
    if (user === username) return myAvatar;
    const friend = friends.find(f => f.username === user);
    return friend ? friend.avatar : null;
  };
  const formatMessage = (text) => {
    if(!text) return "";
    const parts = text.split(/(`[^`]+`)/g);
    return parts.map((part, i) => {
      if(part.startsWith("`")) return <span key={i} className="code-block">{part.slice(1,-1)}</span>;
      return part.split(/(\*\*[^*]+\*\*)/g).map((sub, j) => {
        if(sub.startsWith("**")) return <strong key={j} className="chat-bold">{sub.slice(2,-2)}</strong>;
        return sub.split(/(https?:\/\/[^\s]+)/g).map((lnk, k) => lnk.match(/http/) ? <a key={k} href={lnk} target="_blank" className="chat-link" rel="noreferrer">{lnk}</a> : lnk);
      });
    });
  };
  const handleTyping = (e) => {
    setCurrentMessage(e.target.value);
    socket.emit("typing", { room, author: username });
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => socket.emit("stop_typing", { room }), 2000);
  };
  const selectImage = () => document.getElementById("fileInput").click();
  const handleFileChange = (e) => {
    const f = e.target.files[0];
    if(f) { const r = new FileReader(); r.onloadend = async () => {
       const d = { room, author: username, message: "", image: r.result, time: new Date().getHours() + ":" + String(new Date().getMinutes()).padStart(2,'0') };
       await socket.emit("send_message", d);
       setMessageList((l) => [...l, d]);
    }; r.readAsDataURL(f); }
  };
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messageList, typingUser]); 

  // --- RENDER ---
  return (
    <div className="App">
      <audio ref={remoteAudioRef} />

      {/* --- UPDATE BANNER --- */}
      {updateStatus && (
        <div style={{
          position: 'absolute', top: 0, left: 0, width: '100%', 
          background: '#0055FF', color: 'white', padding: '8px', 
          textAlign: 'center', zIndex: 9999, fontWeight: 'bold', fontSize: '14px',
          boxShadow: '0 2px 10px rgba(0,0,0,0.3)'
        }}>
          {updateStatus}
        </div>
      )}

      {!isLoggedIn ? (
        <div className="joinChatContainer">
          <div className="ios-icon"><div className="inner-icon">C1</div></div>
          <h3>{isRegistering ? "Create Account" : " CranixOne v0.0.4"}</h3>
          <p className="subtitle">Secure Terminal Access</p>
          <input type="text" placeholder="Username" onChange={(e) => setUsername(e.target.value)} />
          <input type="password" placeholder="Password" onChange={(e) => setPassword(e.target.value)} />
          {authError && <p style={{color: '#ff4444', fontSize: '12px', marginBottom:'10px'}}>{authError}</p>}
          {isRegistering ? <button onClick={handleRegister}>Sign Up</button> : <button onClick={handleLogin}>Log In</button>}
          <p className="switch-auth" onClick={() => { setIsRegistering(!isRegistering); setAuthError(""); }}>{isRegistering ? "Already have an account? Log In" : "Need an account? Register"}</p>
        </div>
      ) : (
        <div className="chat-window">
          {/* SIDEBAR */}
          <div className="sidebar">
            <input type="file" id="avatarInput" style={{display:'none'}} accept="image/*" onChange={onAvatarFileChange} />
            <div className="sidebar-icon home-icon" onClick={() => setShowSettings(true)} title="Settings">
               {myAvatar ? <img src={myAvatar} alt="me" className="sidebar-avatar-img"/> : username[0].toUpperCase()}
            </div>
            
            <div className="separator"></div>
            <div className="sidebar-icon" style={{background:'#333', color:'#fff', fontSize:'20px'}} onClick={() => setShowAddFriend(!showAddFriend)} title="Add Friend">+</div>
            {requests.length > 0 && <div className="req-badge">{requests.length}</div>}
            
            <div className="friends-list">
              {friends.map((friend) => (
                <div 
                  key={friend._id} 
                  className={`sidebar-icon friend-icon ${room.includes(friend.username) ? "active" : ""}`} 
                  onClick={() => startChat(friend.username)} 
                  title={friend.username}
                >
                  {friend.avatar ? <img src={friend.avatar} alt={friend.username} className="sidebar-avatar-img"/> : friend.username.charAt(0).toUpperCase()}
                  {onlineUsers.includes(friend.username) && <div className="online-dot-sidebar"></div>}
                </div>
              ))}
            </div>
          </div>

          <div className="chat-interface">
            {/* SETTINGS MODAL */}
            {showSettings && (
              <div className="settings-overlay">
                <div className="settings-card">
                  <div className="settings-sidebar">
                    <div className="settings-tab active">My Account</div>
                  </div>
                  <div className="settings-content">
                    <button className="close-settings" onClick={() => setShowSettings(false)}>✕</button>
                    <h2>My Account</h2>
                    <div className="pfp-section">
                      {myAvatar ? <img src={myAvatar} alt="me" className="large-pfp"/> : <div className="large-pfp" style={{background:'#0055ff', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'30px', fontWeight:'bold'}}>{username[0].toUpperCase()}</div>}
                      <button className="pfp-btn" onClick={handleProfileUpload}>Change Avatar</button>
                    </div>
                    <div style={{marginBottom:'20px'}}>
                      <label style={{color:'#888', fontSize:'12px', display:'block', marginBottom:'5px'}}>USERNAME</label>
                      <input type="text" value={username} disabled style={{width:'100%', background:'#111', border:'1px solid #333', color:'#fff', padding:'10px', borderRadius:'5px'}} />
                    </div>
                    <button className="logout-btn" onClick={handleLogout}>Log Out</button>
                  </div>
                </div>
              </div>
            )}

            {incomingCall && !isInCall && (
              <div className="modal-overlay">
                <div className="modal-box" style={{textAlign:'center'}}>
                  <div className="avatar" style={{width:'80px', height:'80px', margin:'0 auto', fontSize:'30px'}}>
                    {incomingCall.caller[0].toUpperCase()}
                  </div>
                  <h3>{incomingCall.caller} is calling...</h3>
                  <div style={{display:'flex', gap:'10px', justifyContent:'center'}}>
                    <button onClick={answerCall} style={{background:'#22c55e', width:'100px'}}>Answer</button>
                    <button onClick={() => {incomingCall.callObj.close(); setIncomingCall(null);}} style={{background:'#ef4444', width:'100px'}}>Decline</button>
                  </div>
                </div>
              </div>
            )}

            {showAddFriend && (
               <div className="modal-overlay">
                  <div className="modal-box">
                     <h3>Add Friend</h3>
                     <input placeholder="Username..." value={friendInput} onChange={(e) => setFriendInput(e.target.value)} />
                     <button onClick={sendFriendRequest}>Send Request</button>
                     {requests.length > 0 && (
                        <div className="req-list">
                          <p style={{color:'#888', fontSize:'12px', marginTop:'10px'}}>Incoming Requests:</p>
                          {requests.map(req => (
                             <div key={req._id} className="req-item"><span>{req.sender}</span><button style={{width:'30px', height:'30px', padding:0}} onClick={() => acceptRequest(req._id)}>✓</button></div>
                          ))}
                        </div>
                     )}
                     <button className="close-btn" style={{background:'transparent', border:'1px solid #333', color:'#888', marginTop:'10px'}} onClick={() => setShowAddFriend(false)}>Close</button>
                  </div>
               </div>
            )}

            {room ? (
              <>
                <div className="dynamic-island-container">
                  <div className="dynamic-island">
                    <div className={`live-dot ${onlineUsers.includes(room.replace(username, "").replace("_", "")) ? "online" : "offline"}`}></div>
                    <p>@{room.replace(username, "").replace("_", "")}</p>
                    <div className="call-controls" style={{marginLeft:'15px', display:'flex', gap:'10px'}}>
                      {!isInCall ? (
                        <button className="call-btn" onClick={startCall} title="Voice Call">
                          <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M20.01 15.38c-1.23 0-2.42-.2-3.53-.56-.35-.12-.74-.03-1.01.24l-1.57 1.97c-2.83-1.43-5.15-3.75-6.58-6.59l1.97-1.57c.27-.27.35-.66.24-1.02-.36-1.11-.56-2.3-.56-3.53 0-.54-.45-.99-.99-.99H4.19C3.65 3.3 3 3.24 3 3.99 3 13.28 10.73 21 20.01 21c.71 0 .99-.63.99-1.18v-3.45c0-.54-.45-.99-.99-.99z"/></svg>
                        </button>
                      ) : (
                        <>
                          <button className={`call-btn ${isMuted ? "muted" : ""}`} onClick={toggleMute} title={isMuted ? "Unmute" : "Mute"}>
                            {isMuted ? (
                              <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28v-3c0-3.31-2.69-6-6-6-.9 0-1.73.2-2.5.55l1.55 1.55c.3-.07.61-.1.95-.1 2.21 0 4 1.79 4 4v3zm-4 7c0 1.66-1.34 3-3 3s-3-1.34-3-3v-1H7v1c0 2.43 1.77 4.45 4.07 4.91v2.09h1.86v-2.09c2.3-.46 4.07-2.48 4.07-4.91v-1h-2v1zm-3.61-9.61l-7.9-7.9L2 1.98l18.51 18.52 1.41-1.41-3.69-3.69c-1.34 1.01-2.92 1.6-4.63 1.6v-2c1.21 0 2.34-.44 3.24-1.18l-3.32-3.32c-.11.01-.22.02-.33.02-2.21 0-4-1.79-4-4v-1.1L5.83 5.83l1.55 1.55c.01.21.01.42.01.62v3z"/></svg>
                            ) : (
                              <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/><path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/></svg>
                            )}
                          </button>
                          <button className="call-btn hangup" onClick={endCall} title="End Call">
                            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08c-.18-.17-.29-.42-.29-.7 0-.28.11-.53.29-.71C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67c.18.18.29.43.29.71 0 .28-.11.53-.29.71l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.11-.7-.28-.79-.73-1.68-1.36-2.66-1.85-.33-.16-.56-.5-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z"/></svg>
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                <div className="chat-body">
                  {messageList.map((msg, i) => {
                    const userAvatar = getAvatarForUser(msg.author);
                    if (msg.author === "System") {
                      return <div key={i} className="system-message"><span className="system-pill">{msg.message}</span></div>
                    }
                    return (
                      <div className="message-row" key={i}>
                        <div className="avatar">
                          {userAvatar ? <img src={userAvatar} alt="av" className="msg-avatar-img"/> : msg.author[0].toUpperCase()}
                        </div>
                        <div className="message-data">
                          <div className="message-info"><span className="username">{msg.author}</span><span className="timestamp">{msg.time}</span></div>
                          <div className="message-text">
                             {msg.image ? <img src={msg.image} alt="uploaded" className="chat-image" /> : formatMessage(msg.message)}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                  {typingUser && <div className="typing-indicator"><div className="typing-dots"><span></span><span></span><span></span></div><p>{typingUser}</p></div>}
                  <div ref={bottomRef} />
                </div>

                <div className="chat-footer">
                  <div className="input-capsule">
                    <input type="file" id="fileInput" style={{display: "none"}} accept="image/*" onChange={handleFileChange} />
                    <button onClick={selectImage}><svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg></button>
                    <input type="text" value={currentMessage} placeholder={`Message @${room.replace(username, "").replace("_", "")}`} onChange={handleTyping} onKeyPress={(e) => e.key === "Enter" && sendMessage()} />
                    <button onClick={sendMessage}><svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg></button>
                  </div>
                </div>
              </>
            ) : (
              <div className="empty-state">
                 <div className="ios-icon" style={{width:'60px', height:'60px', borderRadius:'18px', marginBottom:'20px'}}><div className="inner-icon" style={{fontSize:'20px'}}>C1</div></div>
                 <h3>CranixOne</h3>
                 <p>Select a friend to start chatting</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default App;