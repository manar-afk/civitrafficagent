import React, { useState, useEffect, useRef } from 'react';

export default function App() {
  const [mapData, setMapData] = useState(null);
  const [incidents, setIncidents] = useState([]);
  const [chatMessages, setChatMessages] = useState([
    {
      sender: 'concierge',
      text: "Hello neighbor! I'm your Civic Path Concierge. Let me know what you need—whether it's finding parking or bypassing today's traffic jams. How can I help you today?",
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }
  ]);
  const [userInput, setUserInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const chatEndRef = useRef(null);

  // Poll for town map state and incident logs
  const fetchState = async () => {
    try {
      const mapRes = await fetch('/api/map');
      if (mapRes.ok) {
        const data = await mapRes.json();
        setMapData(data);
      }
      const incRes = await fetch('/api/incidents');
      if (incRes.ok) {
        const data = await incRes.json();
        setIncidents(data);
      }
    } catch (error) {
      console.error('Failed to fetch town state:', error);
    }
  };

  useEffect(() => {
    fetchState();
    const interval = setInterval(fetchState, 3000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages, isTyping]);

  // Handle Simulation: Bus count update
  const handleUpdateBusCount = async (newCount) => {
    try {
      const res = await fetch('/api/update-bus', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ busCount: newCount })
      });
      if (res.ok) {
        fetchState();
      }
    } catch (error) {
      console.error('Error updating bus count:', error);
    }
  };

  // Handle Simulation: Parking occupancy update
  const handleUpdateParking = async (zoneId, delta) => {
    if (!mapData) return;
    const zone = mapData.nodes.parking_zones[zoneId];
    const newOccupancy = Math.max(0, Math.min(zone.capacity, zone.current_occupancy + delta));
    try {
      const res = await fetch('/api/update-parking', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ zoneId, occupancy: newOccupancy })
      });
      if (res.ok) {
        fetchState();
      }
    } catch (error) {
      console.error('Error updating parking:', error);
    }
  };

  // Handle Simulation: Thoroughfare status update
  const handleUpdateRoad = async (roadId, newStatus) => {
    try {
      const res = await fetch('/api/update-road', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roadId, status: newStatus })
      });
      if (res.ok) {
        fetchState();
      }
    } catch (error) {
      console.error('Error updating road status:', error);
    }
  };

  // Handle Chat message sending
  const handleSendMessage = async (e) => {
    e.preventDefault();
    if (!userInput.trim()) return;

    const userMsgText = userInput;
    const userTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    // Add user message to state
    setChatMessages((prev) => [...prev, { sender: 'user', text: userMsgText, time: userTime }]);
    setUserInput('');
    setIsTyping(true);

    try {
      // Map chat messages format for Vertex AI chat history (converting sender names)
      const history = chatMessages.slice(1).map((msg) => ({
        role: msg.sender === 'user' ? 'user' : 'model',
        parts: [{ text: msg.text }]
      }));

      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userMsgText, history })
      });

      if (res.ok) {
        const data = await res.json();
        setChatMessages((prev) => [
          ...prev,
          {
            sender: 'concierge',
            text: data.reply,
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          }
        ]);
      } else {
        throw new Error('Server returned error status');
      }
    } catch (error) {
      console.error('Chat error:', error);
      setChatMessages((prev) => [
        ...prev,
        {
          sender: 'concierge',
          text: "Oops, I had a slight connection hitch there! Let me re-check with our dispatch—how's the route looking for you?",
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        }
      ]);
    } finally {
      setIsTyping(false);
    }
  };

  if (!mapData) {
    return (
      <div className="loading-container">
        <div className="loader"></div>
        <p>Loading town maps and local state...</p>
      </div>
    );
  }

  const busStand = mapData.nodes.bus_stand;
  const isDistressed = busStand.current_bus_count >= busStand.jam_threshold_buses;

  return (
    <div className="app-container">
      {/* Header Banner */}
      <header className={`app-header ${isDistressed ? 'header-distressed' : ''}`}>
        <div className="header-info">
          <h1>Civic Path</h1>
          <p className="subtitle">AI Concierge & Town Traffic Coordinator</p>
        </div>
        <div className="header-status">
          {isDistressed ? (
            <span className="status-badge alert-flash">
              <span className="dot animate-ping"></span>
              🚨 DISTRESS PROTOCOL ACTIVE (Market Road Jammed)
            </span>
          ) : (
            <span className="status-badge ok-badge">
              <span className="dot"></span>
              🟢 ALL CLEAR
            </span>
          )}
        </div>
      </header>

      {/* Main Grid Layout */}
      <main className="dashboard-grid">
        
        {/* Left Hand Side: Live Status & Simulation Deck */}
        <section className="dashboard-left">
          
          {/* Card: Bus Stand Bottleneck */}
          <div className={`card bus-card ${isDistressed ? 'distressed-glow' : ''}`}>
            <div className="card-header">
              <h2>🚌 Bus Stand Status</h2>
              <span className={`badge ${isDistressed ? 'badge-danger' : 'badge-success'}`}>
                {busStand.status.toUpperCase()}
              </span>
            </div>
            
            <div className="card-body">
              <div className="status-metric">
                <span className="metric-value">{busStand.current_bus_count}</span>
                <span className="metric-label">Buses Parked</span>
              </div>
              
              <div className="slider-container">
                <label>Simulate Bus Congestion (Threshold: {busStand.jam_threshold_buses}):</label>
                <input
                  type="range"
                  min="0"
                  max="10"
                  value={busStand.current_bus_count}
                  onChange={(e) => handleUpdateBusCount(parseInt(e.target.value))}
                  className="simulation-slider"
                />
              </div>

              {isDistressed && (
                <div className="alert-message">
                  <strong>Distress Triggered:</strong> Market Road thoroughfare has been automatically set to <strong>JAMMED</strong>. Priority alert has been saved to the incident log.
                </div>
              )}
            </div>
          </div>

          {/* Card: Parking Zones */}
          <div className="card parking-card">
            <h2>🚗 Parking Zones</h2>
            <div className="parking-list">
              {Object.entries(mapData.nodes.parking_zones).map(([id, zone]) => {
                const available = zone.capacity - zone.current_occupancy;
                const percent = (zone.current_occupancy / zone.capacity) * 100;
                const isFull = zone.status === 'full';
                const landmark = mapData.nodes.landmarks[id];

                return (
                  <div key={id} className={`parking-item ${isFull ? 'zone-full' : ''}`}>
                    <div className="parking-info">
                      <div>
                        <h3>{id.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</h3>
                        <p className="landmark">📍 {landmark}</p>
                      </div>
                      <span className={`badge ${isFull ? 'badge-danger' : 'badge-info'}`}>
                        {isFull ? 'FULL' : `${available} Free`}
                      </span>
                    </div>

                    <div className="progress-bar-container">
                      <div 
                        className={`progress-bar ${percent >= 90 ? 'progress-danger' : percent >= 60 ? 'progress-warning' : 'progress-success'}`}
                        style={{ width: `${percent}%` }}
                      ></div>
                    </div>

                    <div className="parking-controls">
                      <span>{zone.current_occupancy} / {zone.capacity} spots</span>
                      <div className="btn-group">
                        <button 
                          disabled={zone.current_occupancy <= 0}
                          onClick={() => handleUpdateParking(id, -1)}
                          className="btn-sim"
                        >-</button>
                        <button 
                          disabled={zone.current_occupancy >= zone.capacity}
                          onClick={() => handleUpdateParking(id, 1)}
                          className="btn-sim"
                        >+</button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Card: Thoroughfares */}
          <div className="card road-card">
            <h2>🛣️ Road Status</h2>
            <div className="road-list">
              {Object.entries(mapData.nodes.thoroughfares).map(([id, road]) => {
                const isJammed = road.status === 'jammed';
                const isHeavy = road.status === 'heavy';
                
                return (
                  <div key={id} className="road-item">
                    <div className="road-info">
                      <h3>{id.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</h3>
                      <span className={`badge ${isJammed ? 'badge-danger' : isHeavy ? 'badge-warning' : 'badge-success'}`}>
                        {road.status.toUpperCase()}
                      </span>
                    </div>
                    
                    <div className="road-controls">
                      <button 
                        disabled={road.status === 'clear'}
                        onClick={() => handleUpdateRoad(id, 'clear')}
                        className="btn-road"
                      >Clear</button>
                      <button 
                        disabled={road.status === 'heavy'}
                        onClick={() => handleUpdateRoad(id, 'heavy')}
                        className="btn-road"
                      >Heavy</button>
                      <button 
                        disabled={road.status === 'jammed'}
                        onClick={() => handleUpdateRoad(id, 'jammed')}
                        className="btn-road"
                      >Jammed</button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

        </section>

        {/* Right Hand Side: AI Chat Concierge & Log Console */}
        <section className="dashboard-right">
          
          {/* Card: AI Concierge Terminal */}
          <div className="card chat-card">
            <div className="card-header">
              <h2>💬 Chat with Civic Concierge</h2>
              <span className="avatar-dot"></span>
            </div>

            <div className="chat-messages-container">
              {chatMessages.map((msg, index) => (
                <div key={index} className={`message-bubble ${msg.sender === 'user' ? 'msg-user' : 'msg-concierge'}`}>
                  <div className="message-content">
                    <p className="message-text">{msg.text}</p>
                    <span className="message-time">{msg.time}</span>
                  </div>
                </div>
              ))}
              {isTyping && (
                <div className="message-bubble msg-concierge">
                  <div className="message-content typing-content">
                    <span className="typing-dot"></span>
                    <span className="typing-dot"></span>
                    <span className="typing-dot"></span>
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            <form onSubmit={handleSendMessage} className="chat-input-form">
              <input
                type="text"
                value={userInput}
                onChange={(e) => setUserInput(e.target.value)}
                placeholder="Ask about traffic, parking spaces, or routes..."
                className="chat-input"
              />
              <button type="submit" className="chat-send-btn">Send</button>
            </form>
          </div>

          {/* Card: Priority Incident Logs */}
          <div className="card log-card">
            <div className="card-header">
              <h2>🗃️ Priority Incident Console</h2>
              <button onClick={fetchState} className="btn-refresh">🔄 Refresh</button>
            </div>
            <div className="log-console">
              {incidents.length > 0 ? (
                incidents.map((log, index) => (
                  <div key={index} className="log-line">
                    <span className="log-bullet">▶</span> {log}
                  </div>
                ))
              ) : (
                <div className="log-empty">No incidents logged. Thoroughfares are clear!</div>
              )}
            </div>
          </div>

        </section>

      </main>
    </div>
  );
}
