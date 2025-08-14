import { ExtensionServiceWorkerMLCEngineHandler } from "@mlc-ai/web-llm";


let handler;

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === "web_llm_service_worker") {
    console.log("[Background] Content script connected");

    if (!handler) {
      handler = new ExtensionServiceWorkerMLCEngineHandler(port);
      console.log("[Background] Engine handler created");
    } else {
      handler.setPort(port);
      console.log("[Background] Port updated for new tab");
    }

    port.onMessage.addListener(handler.onmessage.bind(handler));
  }
});
