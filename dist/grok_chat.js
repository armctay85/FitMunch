
// Grok Chat Module
const grokChat = (function() {
  let messagesContainer;
  let messageInput;
  let sendButton;
  let chatHistory = [];

  function initialize() {
    messagesContainer = document.querySelector('.grok-messages');
    messageInput = document.getElementById('userMessage');
    sendButton = document.getElementById('sendMessage');

    if (!messagesContainer || !messageInput || !sendButton) {
      console.error('Chat elements not found');
      return false;
    }

    // Add event listeners
    sendButton.addEventListener('click', sendUserMessage);
    messageInput.addEventListener('keypress', function(e) {
      if (e.key === 'Enter') {
        sendUserMessage();
      }
    });

    // Add initial message
    addMessage('assistant', "Hello! I'm Grok, your FitMunch assistant. I can help with meal planning, workout advice, nutrition information, and shopping tips. How can I assist you today?");

    // Add initial suggestion chips
    addSuggestionChips([
      "Meal plan ideas",
      "Workout recommendations",
      "Healthy shopping list"
    ]);

    return true;
  }

  // Send user message
  function sendUserMessage() {
    if (!messageInput || !messageInput.value.trim()) return;

    const userMessage = messageInput.value.trim();
    addMessage('user', userMessage);
    
    // Store in chat history
    chatHistory.push({
      role: 'user',
      content: userMessage,
      timestamp: new Date()
    });

    // Clear input
    messageInput.value = '';

    // Process the message and generate response
    processUserMessage(userMessage);
  }

  // Process user message and generate response
  async function processUserMessage(userMessage) {
    try {
      // Add typing indicator
      const typingIndicator = document.createElement('div');
      typingIndicator.className = 'typing-indicator';
      typingIndicator.innerHTML = '<span></span><span></span><span></span>';
      messagesContainer.appendChild(typingIndicator);
      messagesContainer.scrollTop = messagesContainer.scrollHeight;

      // In a production app, this would call an API or ML model
      // For this demo, we'll use simple pattern matching
      let response;
      await new Promise(resolve => setTimeout(resolve, 1000)); // Simulate processing time

      // Simple pattern matching for response generation
      if (userMessage.toLowerCase().includes('hello') || userMessage.toLowerCase().includes('hi')) {
        response = "Hello! How can I help with your health and fitness goals today?";
      } else if (userMessage.toLowerCase().includes('meal') || userMessage.toLowerCase().includes('food') || userMessage.toLowerCase().includes('eat')) {
        response = "For balanced meals, aim for a mix of protein, complex carbs, and vegetables. Would you like meal plan suggestions or specific recipe ideas?";
      } else if (userMessage.toLowerCase().includes('workout') || userMessage.toLowerCase().includes('exercise')) {
        response = "Regular exercise is key to fitness. A good routine includes strength training, cardio, and flexibility work. Would you like specific workout recommendations?";
      } else if (userMessage.toLowerCase().includes('shopping') || userMessage.toLowerCase().includes('buy') || userMessage.toLowerCase().includes('store')) {
        response = "Smart grocery shopping starts with a plan. Focus on whole foods from the perimeter of the store. Would you like help creating a healthy shopping list?";
      } else {
        response = "I'm here to help with all your fitness and nutrition needs. You can ask about meal planning, workout routines, nutrition information, or shopping assistance.";
      }

      // Remove typing indicator
      messagesContainer.removeChild(typingIndicator);

      // Add response message
      addMessage('assistant', response);

      // Store in chat history
      chatHistory.push({
        role: 'assistant',
        content: response,
        timestamp: new Date()
      });

      // Add new suggestion chips based on context
      if (userMessage.toLowerCase().includes('meal') || userMessage.toLowerCase().includes('food')) {
        addSuggestionChips([
          "What's a healthy breakfast?",
          "Meal prep ideas",
          "Protein-rich foods"
        ]);
      } else if (userMessage.toLowerCase().includes('workout') || userMessage.toLowerCase().includes('exercise')) {
        addSuggestionChips([
          "Home workout routine",
          "How to build muscle",
          "Cardio exercises"
        ]);
      } else if (userMessage.toLowerCase().includes('shopping') || userMessage.toLowerCase().includes('buy')) {
        addSuggestionChips([
          "Healthy shopping list",
          "Budget-friendly foods",
          "Meal planning"
        ]);
      }
    } catch (error) {
      console.error('Error processing message:', error);

      // Remove typing indicator
      messagesContainer.removeChild(typingIndicator);

      // Add error message
      addMessage('assistant', "I'm having trouble processing your request. Please try again later.");
    }
  }

  // Add message to chat
  function addMessage(role, content) {
    if (!messagesContainer) return;

    const messageDiv = document.createElement('div');
    messageDiv.className = `grok-message ${role === 'user' ? 'outgoing' : 'incoming'}`;
    
    messageDiv.innerHTML = `
      <div class="message-avatar">
        <i class="fas fa-${role === 'user' ? 'user' : 'robot'}"></i>
      </div>
      <div class="message-content">
        <p>${content}</p>
      </div>
    `;

    messagesContainer.appendChild(messageDiv);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  // Add suggestion chips
  function addSuggestionChips(suggestions) {
    if (!messagesContainer) return;

    const chipsDiv = document.createElement('div');
    chipsDiv.className = 'suggestion-chips';

    suggestions.forEach(suggestion => {
      const chip = document.createElement('button');
      chip.className = 'suggestion-chip';
      chip.textContent = suggestion;
      chip.addEventListener('click', function() {
        messageInput.value = suggestion;
        sendUserMessage();
      });

      chipsDiv.appendChild(chip);
    });

    messagesContainer.appendChild(chipsDiv);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  // Initialize on DOM ready
  document.addEventListener('DOMContentLoaded', initialize);

  // Return public methods
  return {
    initialize,
    sendMessage: sendUserMessage,
    addSuggestion: function(suggestion) {
      if (messageInput) {
        messageInput.value = suggestion;
        sendUserMessage();
      }
    },
    getChatHistory: function() {
      return chatHistory;
    }
  };
})();

// If running in Node.js environment, export the module
if (typeof module !== 'undefined' && module.exports) {
  module.exports = grokChat;
}
