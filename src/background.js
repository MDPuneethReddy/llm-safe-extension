// Simple background script - no WebLLM engine loading
// Engine is now handled in content scripts via BroadcastChannel

class SimpleBackgroundManager {
  constructor() {
    this.connectedPorts = new Set();
  }

  handlePortConnection(port) {
    console.log("[Background] Tab connected");
    
    this.connectedPorts.add(port);

    port.onMessage.addListener((message) => {
      console.log("[Background] Received message:", message.type);
      
      switch (message.type) {
        case "ping":
          port.postMessage({
            id: message.id,
            type: "pong"
          });
          break;
          
        case "status":
          port.postMessage({
            id: message.id,
            type: "status_response",
            connectedTabs: this.connectedPorts.size
          });
          break;
          
        default:
          console.warn("[Background] Unknown message type:", message.type);
      }
    });

    port.onDisconnect.addListener(() => {
      console.log("[Background] Tab disconnected");
      this.connectedPorts.delete(port);
    });
  }

  broadcastToAllPorts(message) {
    this.connectedPorts.forEach(port => {
      try {
        port.postMessage(message);
      } catch (error) {
        console.warn("[Background] Failed to send message to port:", error);
        this.connectedPorts.delete(port);
      }
    });
  }
}

// Create simple manager
const manager = new SimpleBackgroundManager();

// Handle connections from content scripts (if needed for other purposes)
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === "web_llm_service_worker") {
    manager.handlePortConnection(port);
  }
});

// Optional: Extension lifecycle logging
chrome.runtime.onStartup.addListener(() => {
  console.log("[Background] Extension starting up");
});

chrome.runtime.onInstalled.addListener((details) => {
  console.log("[Background] Extension installed:", details.reason);
});

chrome.runtime.onSuspend.addListener(() => {
  console.log("[Background] Extension suspending");
});