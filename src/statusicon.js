  export function getSavedPosition() {
    try {
      const saved = localStorage.getItem('sensitive-detector-position');
      if (saved) {
        const position = JSON.parse(saved);
        // Validate position is within viewport bounds
        const maxRight = Math.max(20, window.innerWidth - 70);
        const maxBottom = Math.max(20, window.innerHeight - 70);
        return {
          right: Math.min(Math.max(20, position.right), maxRight),
          bottom: Math.min(Math.max(20, position.bottom), maxBottom)
        };
      }
    } catch (error) {
      console.warn("Could not load saved position:", error);
    }
    
    // Default position
    return {
      right: 20,
      bottom: 20
    };
  }
  export function savePosition(right, bottom) {
    try {
      localStorage.setItem('sensitive-detector-position', JSON.stringify({
        right: right,
        bottom: bottom
      }));
    } catch (error) {
      console.warn("Could not save position:", error);
    }
  }

  export function getStatusConfig(status) {
  switch (status) {
    case 'not-ready':
      return {
        backgroundColor: '#dc2626',
        title: '🔴 AI Engine Not Ready - Loading...\n(Click for info, drag to move)',
        spinnerOpacity: '0',
        textOpacity: '1',
      };
    case 'loading':
      return {
        backgroundColor: '#f59e0b',
        title: '🟡 AI Engine Loading...\n(Click for info, drag to move)',
        spinnerOpacity: '0',
        textOpacity: '1',
      };
    case 'ready':
      return {
        backgroundColor: '#059669',
        title: '🟢 AI Engine Ready - Monitoring Text\n(Click for info, drag to move)',
        spinnerOpacity: '0',
        textOpacity: '1',
      };
    case 'processing':
      return {
        backgroundColor: null, // keep current
        title: '⚡ Processing Text...\n(Click for info, drag to move)',
        spinnerOpacity: '1',
        textOpacity: '0.3',
      };
    case 'error':
      return {
        backgroundColor: '#7c2d12',
        title: '❌ AI Engine Error\n(Click for info, drag to move)',
        spinnerOpacity: '0',
        textOpacity: '1',
      };
    default:
      return null;
  }
}
export function getTooltipText({ isInitialized, isMainTab, isProcessing }) {
  if (!isInitialized && !isMainTab) {
    return `🔴 Engine Not Ready
Waiting for AI model to load...

💡 Tip: Drag the button to move it around!`;
  }

  else if (!isInitialized && isMainTab) {
    return `🟡 Loading AI Model
This may take a few moments...

💡 Tip: Drag the button to move it around!`;
  }

  else if (isProcessing) {
    return `⚡ Processing Text
Analyzing for sensitive content...

💡 Tip: Drag the button to move it around!`;
  }
  else{

  return `🟢 Ready & Monitoring
AI engine is active and watching for sensitive text

💡 Tip: Drag the button to move it around!`;
  }
}
