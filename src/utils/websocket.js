import { useState, useEffect, useRef, useCallback } from 'react';

export function useWebSocket() {
  const [ws, setWs] = useState(null);
  const [messages, setMessages] = useState([]);
  const [isConnected, setIsConnected] = useState(false);
  const wsRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const pingIntervalRef = useRef(null);
  const pendingMessagesRef = useRef([]);

  const cleanup = useCallback(() => {
    if (pingIntervalRef.current) {
      clearInterval(pingIntervalRef.current);
      pingIntervalRef.current = null;
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
  }, []);

  const connect = useCallback(async () => {
    try {
      const token = localStorage.getItem('auth-token');
      if (!token) {
        return;
      }

      // Cleanup existing connection if any
      if (wsRef.current && (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)) {
        return;
      }

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/ws?token=${encodeURIComponent(token)}`;
      
      console.log('🔗 Connecting to WebSocket:', wsUrl);
      const websocket = new WebSocket(wsUrl);
      wsRef.current = websocket;

      websocket.onopen = () => {
        console.log('✅ WebSocket connected successfully');
        setIsConnected(true);
        setWs(websocket);

        // Setup heartbeat ping every 25 seconds to keep FRP proxy alive
        if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
        pingIntervalRef.current = setInterval(() => {
          if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ type: 'ping' }));
          }
        }, 25000);

        // Flush any queued messages
        while (pendingMessagesRef.current.length > 0) {
          const msg = pendingMessagesRef.current.shift();
          console.log('🚀 Sending queued message:', msg);
          websocket.send(JSON.stringify(msg));
        }
      };

      websocket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          // Ignore heartbeat pong messages
          if (data.type === 'pong') return;
          setMessages(prev => [...prev, data]);
        } catch (error) {
          console.error('Error parsing WebSocket message:', error);
        }
      };

      websocket.onclose = (event) => {
        console.warn('🔌 WebSocket disconnected (code:', event.code, ') - reconnecting in 2s');
        setIsConnected(false);
        setWs(null);
        wsRef.current = null;
        if (pingIntervalRef.current) {
          clearInterval(pingIntervalRef.current);
          pingIntervalRef.current = null;
        }

        // Reconnect after 2 seconds
        reconnectTimeoutRef.current = setTimeout(() => {
          connect();
        }, 2000);
      };

      websocket.onerror = (error) => {
        console.error('❌ WebSocket error:', error);
      };

    } catch (error) {
      console.error('Error creating WebSocket connection:', error);
    }
  }, []);

  useEffect(() => {
    connect();
    return () => cleanup();
  }, [connect, cleanup]);

  const sendMessage = useCallback((message) => {
    const socket = wsRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
      return true;
    } else if (socket && socket.readyState === WebSocket.CONNECTING) {
      console.log('⏳ WebSocket connecting, queuing message to send on connect...');
      pendingMessagesRef.current.push(message);
      return true;
    } else {
      console.warn('⚠️ WebSocket not ready. Triggering reconnect and queuing message...');
      pendingMessagesRef.current.push(message);
      connect();
      return true;
    }
  }, [connect]);

  return {
    ws,
    sendMessage,
    messages,
    isConnected
  };
}
