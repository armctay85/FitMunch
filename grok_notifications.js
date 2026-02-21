
// Grok Notifications System
class GrokNotifications {
  constructor() {
    this.container = null;
    this.timeout = 5000; // Default timeout
    this.position = 'top-right'; // Default position
    this.initialized = false;
  }
  
  // Initialize the notification container
  initialize() {
    if (this.initialized) return;
    
    // Create notification container
    this.container = document.createElement('div');
    this.container.className = 'grok-notifications';
    
    // Add styles
    const style = document.createElement('style');
    style.textContent = `
      .grok-notifications {
        position: fixed;
        z-index: 9999;
        display: flex;
        flex-direction: column;
        gap: 10px;
        max-width: 350px;
        width: 100%;
        pointer-events: none;
      }
      
      .grok-notification {
        background-color: white;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        padding: 12px 16px;
        margin: 0;
        transform: translateX(120%);
        opacity: 0;
        transition: all 0.3s ease;
        pointer-events: auto;
        position: relative;
        overflow: hidden;
      }
      
      .grok-notification.show {
        transform: translateX(0);
        opacity: 1;
      }
      
      .grok-notification.success {
        border-left: 4px solid #4caf50;
      }
      
      .grok-notification.error {
        border-left: 4px solid #f44336;
      }
      
      .grok-notification.info {
        border-left: 4px solid #2196f3;
      }
      
      .grok-notification.warning {
        border-left: 4px solid #ff9800;
      }
      
      .grok-notification-title {
        font-weight: 600;
        margin: 0 0 4px 0;
        padding-right: 20px;
      }
      
      .grok-notification-message {
        margin: 0;
        font-size: 14px;
        color: #555;
      }
      
      .grok-notification-close {
        position: absolute;
        top: 8px;
        right: 8px;
        background: none;
        border: none;
        color: #999;
        cursor: pointer;
        font-size: 16px;
        padding: 0;
        width: 20px;
        height: 20px;
        line-height: 1;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      
      .grok-notification-progress {
        position: absolute;
        bottom: 0;
        left: 0;
        height: 3px;
        background-color: rgba(0, 0, 0, 0.1);
        width: 100%;
      }
      
      .grok-notification-progress-bar {
        height: 100%;
        background-color: currentColor;
        width: 100%;
      }
      
      /* Positions */
      .grok-notifications.top-right {
        top: 20px;
        right: 20px;
      }
      
      .grok-notifications.top-left {
        top: 20px;
        left: 20px;
      }
      
      .grok-notifications.bottom-right {
        bottom: 20px;
        right: 20px;
      }
      
      .grok-notifications.bottom-left {
        bottom: 20px;
        left: 20px;
      }
      
      /* Animation for top-left and bottom-left positions */
      .grok-notifications.top-left .grok-notification,
      .grok-notifications.bottom-left .grok-notification {
        transform: translateX(-120%);
      }
    `;
    
    document.head.appendChild(style);
    document.body.appendChild(this.container);
    this.updatePosition(this.position);
    
    this.initialized = true;
  }
  
  // Update notification container position
  updatePosition(position) {
    if (!this.container) this.initialize();
    
    this.position = position;
    this.container.className = `grok-notifications ${position}`;
  }
  
  // Show notification
  show(options) {
    if (!this.container) this.initialize();
    
    const {
      title,
      message,
      type = 'info',
      duration = this.timeout,
      onClose
    } = options;
    
    // Create notification element
    const notification = document.createElement('div');
    notification.className = `grok-notification ${type}`;
    
    // Add content
    notification.innerHTML = `
      <div class="grok-notification-content">
        ${title ? `<h4 class="grok-notification-title">${title}</h4>` : ''}
        ${message ? `<p class="grok-notification-message">${message}</p>` : ''}
      </div>
      <button class="grok-notification-close">&times;</button>
      <div class="grok-notification-progress">
        <div class="grok-notification-progress-bar"></div>
      </div>
    `;
    
    // Add close functionality
    const closeBtn = notification.querySelector('.grok-notification-close');
    closeBtn.addEventListener('click', () => this.close(notification, onClose));
    
    // Add to container
    this.container.appendChild(notification);
    
    // Show with animation
    setTimeout(() => {
      notification.classList.add('show');
    }, 10);
    
    // Animate progress bar
    const progressBar = notification.querySelector('.grok-notification-progress-bar');
    progressBar.style.transition = `width ${duration}ms linear`;
    
    // Trigger reflow to ensure transition works
    progressBar.getBoundingClientRect();
    progressBar.style.width = '0%';
    
    // Auto close after duration
    if (duration) {
      notification.timeout = setTimeout(() => {
        this.close(notification, onClose);
      }, duration);
    }
    
    return notification;
  }
  
  // Show success notification
  success(message, title = 'Success', duration = this.timeout) {
    return this.show({
      title,
      message,
      type: 'success',
      duration
    });
  }
  
  // Show error notification
  error(message, title = 'Error', duration = this.timeout) {
    return this.show({
      title,
      message,
      type: 'error',
      duration
    });
  }
  
  // Show info notification
  info(message, title = 'Information', duration = this.timeout) {
    return this.show({
      title,
      message,
      type: 'info',
      duration
    });
  }
  
  // Show warning notification
  warning(message, title = 'Warning', duration = this.timeout) {
    return this.show({
      title,
      message,
      type: 'warning',
      duration
    });
  }
  
  // Close notification
  close(notification, callback) {
    if (!notification) return;
    
    // Clear timeout
    if (notification.timeout) {
      clearTimeout(notification.timeout);
    }
    
    // Remove with animation
    notification.classList.remove('show');
    
    // Remove after animation
    setTimeout(() => {
      if (notification.parentNode === this.container) {
        this.container.removeChild(notification);
      }
      
      // Call callback if provided
      if (typeof callback === 'function') {
        callback();
      }
    }, 300);
  }
  
  // Clear all notifications
  clearAll() {
    if (!this.container) return;
    
    const notifications = this.container.querySelectorAll('.grok-notification');
    notifications.forEach(notification => {
      this.close(notification);
    });
  }
}

// Export as singleton
const grokNotifications = new GrokNotifications();
export default grokNotifications;
