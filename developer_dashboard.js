// Import the Grok Developer module, scheduler, chat, code analyzer, and notifications
import grokDeveloper from './grok_developer.js';
import grokScheduler from './grok_scheduler.js';
import grokChat from './grok_chat.js';
import codeAnalyzer from './code_analyzer.js';
import grokNotifications from './grok_notifications.js';
import DeveloperAnalytics from './developer_analytics.js'; // Added import for developer analytics

// Make sure updateChatUI is available globally
window.updateChatUI = function(thinkingMessage) {
  if (grokChat && typeof grokChat.updateChatUI === 'function') {
    grokChat.updateChatUI(thinkingMessage);
  }
};

// DOM Elements
const navItems = document.querySelectorAll('.dev-sidebar .nav-item');
const sections = document.querySelectorAll('.dev-section');
const analyzeBtn = document.getElementById('analyze-btn');
const generateBtn = document.getElementById('generate-btn');
const enhancementsGrid = document.getElementById('enhancements-grid');
const roadmapContainer = document.getElementById('roadmap-container');
const activityList = document.getElementById('activity-list');
const fileSelect = document.getElementById('file-select');
const analyzeCodeBtn = document.getElementById('analyze-code-btn');
const codeScore = document.getElementById('code-score');
const codeStrengths = document.getElementById('code-strengths');
const codeImprovements = document.getElementById('code-improvements');
const codeRecommendations = document.getElementById('code-recommendations');

// Navigation
navItems.forEach(item => {
  item.addEventListener('click', () => {
    // Remove active class from all items and sections
    navItems.forEach(i => i.classList.remove('active'));
    sections.forEach(s => s.classList.remove('active-section'));

    // Add active class to clicked item and corresponding section
    item.classList.add('active');
    const sectionId = item.getAttribute('data-section');
    document.getElementById(sectionId).classList.add('active-section');
  });
});

// Initialize dashboard data
function initDashboard() {
  // Initialize analytics
  DeveloperAnalytics.initialize();

  // Generate sample analysis data
  const dashboard = grokDeveloper.getDeveloperDashboard();

  // Update enhancements grid
  renderEnhancements();

  // Update roadmap
  renderRoadmap();

  // Update activity log
  renderActivityLog();
}

// Generate enhancement suggestions
function renderEnhancements() {
  const suggestions = grokDeveloper.generateEnhancementSuggestions();

  if (!enhancementsGrid) return;

  enhancementsGrid.innerHTML = '';

  suggestions.forEach(suggestion => {
    const card = document.createElement('div');
    card.className = 'enhancement-card';

    // Map impact and effort to readable labels
    const impactLabels = {
      'low': 'Low Impact',
      'medium': 'Medium Impact',
      'high': 'High Impact'
    };

    const effortLabels = {
      'low': 'Low Effort',
      'medium': 'Medium Effort',
      'high': 'High Effort'
    };

    // Create card content
    card.innerHTML = `
      <div class="card-header">
        <h3>${suggestion.title}</h3>
      </div>
      <div class="card-body">
        <p class="card-description">${suggestion.description}</p>
        <div class="card-meta">
          <div class="meta-item">
            <i class="fas fa-bolt"></i>
            <span>${impactLabels[suggestion.impact]}</span>
          </div>
          <div class="meta-item">
            <i class="fas fa-clock"></i>
            <span>${effortLabels[suggestion.effort]}</span>
          </div>
        </div>
        <div class="card-actions">
          <button class="action-btn primary" onclick="startEnhancement('${suggestion.id}')">Implement</button>
          <button class="action-btn secondary" onclick="viewImplementationPlan('${suggestion.id}')">View Plan</button>
        </div>
      </div>
    `;

    enhancementsGrid.appendChild(card);
  });
}

// Generate roadmap
function renderRoadmap() {
  const roadmap = grokDeveloper.generateRoadmap();

  if (!roadmapContainer) return;

  roadmapContainer.innerHTML = '';

  roadmap.phases.forEach(phase => {
    const phaseElement = document.createElement('div');
    phaseElement.className = 'roadmap-phase';

    phaseElement.innerHTML = `
      <div class="phase-header">
        <h3>${phase.name}</h3>
        <div class="phase-duration">Duration: ${phase.duration}</div>
      </div>
      <div class="phase-focus">${phase.focus}</div>
      <div class="phase-enhancements">
        ${phase.enhancements.map(enhancement => `
          <div class="enhancement-item">
            <h4>${enhancement.title}</h4>
            <div class="enhancement-details">
              <span>${enhancement.description.substring(0, 60)}...</span>
              <span>${enhancement.impact} impact / ${enhancement.effort} effort</span>
            </div>
          </div>
        `).join('')}
      </div>
    `;

    roadmapContainer.appendChild(phaseElement);
  });
}

// Generate activity log
function renderActivityLog() {
  if (!activityList) return;

  // Sample activity data
  const activities = [
    {
      type: 'analysis',
      description: 'Project analyzed by Grok',
      time: new Date(Date.now() - 2 * 60 * 60 * 1000) // 2 hours ago
    },
    {
      type: 'suggestion',
      description: 'Generated 6 enhancement suggestions',
      time: new Date(Date.now() - 1.5 * 60 * 60 * 1000) // 1.5 hours ago
    },
    {
      type: 'plan',
      description: 'Created implementation plan for Firebase Integration',
      time: new Date(Date.now() - 1 * 60 * 60 * 1000) // 1 hour ago
    },
    {
      type: 'review',
      description: 'Code review performed on script.js',
      time: new Date(Date.now() - 30 * 60 * 1000) // 30 minutes ago
    }
  ];

  activityList.innerHTML = '';

  activities.forEach(activity => {
    const item = document.createElement('li');
    item.className = 'activity-item';

    // Map activity type to icon
    const icons = {
      'analysis': 'fa-search',
      'suggestion': 'fa-lightbulb',
      'plan': 'fa-clipboard-list',
      'review': 'fa-code'
    };

    const timeAgo = getTimeAgo(activity.time);

    item.innerHTML = `
      <div class="activity-icon">
        <i class="fas ${icons[activity.type] || 'fa-circle'}"></i>
      </div>
      <div class="activity-content">
        <p>${activity.description}</p>
        <span class="activity-time">${timeAgo}</span>
      </div>
    `;

    activityList.appendChild(item);
  });
}

// Analyze code using the enhanced code analyzer
function analyzeSelectedCode() {
  if (!fileSelect || !codeScore || !codeStrengths || !codeImprovements || !codeRecommendations) return;

  const selectedFile = fileSelect.value;

  // Show loading indicator
  codeScore.innerHTML = '<span class="spinner" style="display: inline-block; width: 20px; height: 20px; border: 2px solid rgba(74,110,245,0.2); border-left-color: var(--primary-dev-color); border-radius: 50%; animation: spin 1s linear infinite;"></span>';

  codeStrengths.innerHTML = '<li>Analyzing...</li>';
  codeImprovements.innerHTML = '<li>Analyzing...</li>';
  codeRecommendations.innerHTML = '<li>Analyzing...</li>';

  // Get code content for actual analysis
  let codeContent = '';

  // Try to fetch the actual file content for advanced analysis
  fetch(selectedFile)
    .then(response => {
      if (!response.ok) {
        throw new Error('Could not load file');
      }
      return response.text();
    })
    .then(content => {
      codeContent = content;

      // Determine language from file extension
      const fileExt = selectedFile.split('.').pop().toLowerCase();
      const language = fileExt === 'js' ? 'javascript' : 
                      fileExt === 'py' ? 'python' : 
                      fileExt === 'html' ? 'html' : 
                      fileExt === 'css' ? 'css' : 'unknown';

      // Use the new enhanced code analyzer
      const analysisResult = codeAnalyzer.analyzeCode(codeContent, language);

      // Update UI with results
      codeScore.textContent = analysisResult.overallScore || 75;

      // Update strengths
      codeStrengths.innerHTML = '';

      // Add analysis metrics as strengths
      const metricsList = [
        `Code Maintainability: ${analysisResult.metrics.maintainability}%`,
        `Code Performance: ${analysisResult.metrics.performance}%`,
        `Code Security: ${analysisResult.metrics.security}%`
      ];

      if (analysisResult.metrics.maintainability > 70) {
        metricsList.push('Good code organization and structure');
      }

      if (analysisResult.metrics.performance > 70) {
        metricsList.push('Efficient code implementation');
      }

      if (analysisResult.metrics.security > 70) {
        metricsList.push('Secure coding practices');
      }

      metricsList.forEach(strength => {
        const li = document.createElement('li');
        li.textContent = strength;
        codeStrengths.appendChild(li);
      });

      // Update improvements
      codeImprovements.innerHTML = '';

      // Add suggestions from the analyzer
      analysisResult.suggestions.forEach(suggestion => {
        const li = document.createElement('li');
        li.textContent = suggestion.message;

        // Add severity indicator
        if (suggestion.severity === 'high') {
          li.innerHTML = '<span style="color: #f44336;">●</span> ' + li.innerHTML;
        } else if (suggestion.severity === 'medium') {
          li.innerHTML = '<span style="color: #ff9800;">●</span> ' + li.innerHTML;
        } else {
          li.innerHTML = '<span style="color: #4caf50;">●</span> ' + li.innerHTML;
        }

        codeImprovements.appendChild(li);
      });

      // Update recommendations
      codeRecommendations.innerHTML = '';

      // Add vulnerabilities as recommendations
      if (analysisResult.vulnerabilities.length > 0) {
        analysisResult.vulnerabilities.forEach(vulnerability => {
          const li = document.createElement('li');
          li.textContent = vulnerability.message;
          li.style.color = '#f44336';
          codeRecommendations.appendChild(li);
        });
      }

      // Add general recommendations based on score
      if (analysisResult.overallScore < 50) {
        const li = document.createElement('li');
        li.textContent = 'Consider a comprehensive code review to improve overall quality';
        codeRecommendations.appendChild(li);
      }

      if (analysisResult.metrics.maintainability < 60) {
        const li = document.createElement('li');
        li.textContent = 'Improve code readability with better naming and comments';
        codeRecommendations.appendChild(li);
      }

      if (analysisResult.metrics.performance < 60) {
        const li = document.createElement('li');
        li.textContent = 'Optimize performance by reducing repeated operations and improving algorithms';
        codeRecommendations.appendChild(li);
      }
    })
    .catch(error => {
      console.error('Error analyzing code:', error);

      // Fallback to simulation if file can't be loaded
      const analysisResult = grokDeveloper.reviewCode('// Sample code snippet', selectedFile);

      // Update UI with fallback results
      codeScore.textContent = analysisResult.quality.score * 10;

      codeStrengths.innerHTML = '';
      analysisResult.quality.strengths.forEach(strength => {
        const li = document.createElement('li');
        li.textContent = strength;
        codeStrengths.appendChild(li);
      });

      codeImprovements.innerHTML = '';
      analysisResult.quality.improvements.forEach(improvement => {
        const li = document.createElement('li');
        li.textContent = improvement;
        codeImprovements.appendChild(li);
      });

      codeRecommendations.innerHTML = '';
      analysisResult.performance.recommendations.forEach(recommendation => {
        const li = document.createElement('li');
        li.textContent = recommendation;
        codeRecommendations.appendChild(li);
      });

      // Add security recommendations
      analysisResult.security.recommendations.forEach(recommendation => {
        const li = document.createElement('li');
        li.textContent = recommendation;
        codeRecommendations.appendChild(li);
      });
    });
}

// Helper function to format time ago
function getTimeAgo(date) {
  const seconds = Math.floor((new Date() - date) / 1000);

  let interval = seconds / 31536000;
  if (interval > 1) return Math.floor(interval) + " years ago";

  interval = seconds / 2592000;
  if (interval > 1) return Math.floor(interval) + " months ago";

  interval = seconds / 86400;
  if (interval > 1) return Math.floor(interval) + " days ago";

  interval = seconds / 3600;
  if (interval > 1) return Math.floor(interval) + " hours ago";

  interval = seconds / 60;
  if (interval > 1) return Math.floor(interval) + " minutes ago";

  return Math.floor(seconds) + " seconds ago";
}

// Event listeners
if (analyzeBtn) {
  analyzeBtn.addEventListener('click', () => {
    // Initialize notifications
    grokNotifications.initialize();

    // Show a loading notification
    grokNotifications.info('Analyzing project...', 'Analysis in Progress', 0);

    // Analyze project
    setTimeout(() => {
      try {
        grokDeveloper.analyzeProject();

        // Clear all notifications
        grokNotifications.clearAll();

        // Show success notification
        grokNotifications.success('Project analysis complete! Results have been updated.', 'Analysis Complete');

        // Update dashboard with new data
        initDashboard();
      } catch (error) {
        console.error('Error analyzing project:', error);

        // Clear all notifications
        grokNotifications.clearAll();

        // Show error notification
        grokNotifications.error('Failed to complete project analysis. Please try again.', 'Analysis Error');
      }
    }, 1500);
  });
}

if (generateBtn) {
  generateBtn.addEventListener('click', () => {
    // Initialize notifications
    grokNotifications.initialize();

    // Show loading notification
    grokNotifications.info('Generating enhancement suggestions...', 'Generation in Progress', 0);

    // Generate suggestions
    setTimeout(() => {
      try {
        const suggestions = grokDeveloper.generateEnhancementSuggestions();
        renderEnhancements();

        // Clear loading notification
        grokNotifications.clearAll();

        // Show success notification
        grokNotifications.success(`${suggestions.length} new enhancement suggestions generated!`, 'Generation Complete');
      } catch (error) {
        console.error('Error generating suggestions:', error);

        // Clear loading notification
        grokNotifications.clearAll();

        // Show error notification
        grokNotifications.error('Failed to generate enhancement suggestions. Please try again.', 'Generation Error');
      }
    }, 1500);
  });
}

if (analyzeCodeBtn) {
  analyzeCodeBtn.addEventListener('click', analyzeSelectedCode);
}

// Global functions for enhancement actions
window.startEnhancement = function(enhancementId) {
  const enhancement = grokDeveloper.startEnhancement(enhancementId);
  alert(`Enhancement "${enhancement.title}" has been started!`);
};

window.viewImplementationPlan = function(enhancementId) {
  const plan = grokDeveloper.generateImplementationPlan(enhancementId);

  // Create a modal to display the plan
  const modal = document.createElement('div');
  modal.style.position = 'fixed';
  modal.style.top = '0';
  modal.style.left = '0';
  modal.style.width = '100%';
  modal.style.height = '100%';
  modal.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
  modal.style.display = 'flex';
  modal.style.alignItems = 'center';
  modal.style.justifyContent = 'center';
  modal.style.zIndex = '1000';

  const modalContent = document.createElement('div');
  modalContent.style.backgroundColor = 'white';
  modalContent.style.padding = '30px';
  modalContent.style.borderRadius = '10px';
  modalContent.style.maxWidth = '600px';
  modalContent.style.width = '80%';
  modalContent.style.maxHeight = '80vh';
  modalContent.style.overflow = 'auto';

  modalContent.innerHTML = `
    <h2>${plan.title}</h2>
    <h3>Implementation Steps:</h3>
    <ol>
      ${plan.steps.map(step => `<li>${step}</li>`).join('')}
    </ol>
    <h3>Resources:</h3>
    <ul>
      ${plan.resources.map(resource => `
        <li>
          ${resource.url ? 
            `<a href="${resource.url}" target="_blank">${resource.type}</a>` : 
            `${resource.type}: ${resource.title}`
          }
        </li>
      `).join('')}
    </ul>
    <p><strong>Estimated Time:</strong> ${plan.estimatedTime}</p>
    <button id="closeModal" style="
      background-color: var(--primary-dev-color);
      color: white;
      border: none;
      padding: 10px 20px;
      border-radius: 5px;
      cursor: pointer;
      margin-top: 20px;
    ">Close</button>
  `;

  modal.appendChild(modalContent);
  document.body.appendChild(modal);

  document.getElementById('closeModal').addEventListener('click', () => {
    document.body.removeChild(modal);
  });
};

// Scheduler functionality
function initScheduler() {
  const toggleBtn = document.getElementById('toggle-scheduler');
  const schedulerStatus = document.getElementById('scheduler-status');
  const statusIndicator = document.getElementById('status-indicator');
  const taskCount = document.getElementById('task-count');
  const currentOperation = document.getElementById('current-operation');
  const lastRun = document.getElementById('last-run');
  const scheduledTasks = document.getElementById('scheduled-tasks');
  const jobHistory = document.getElementById('job-history');
  const addScheduleBtn = document.getElementById('add-schedule');
  const taskModal = document.getElementById('task-modal');
  const closeModalBtn = document.querySelector('.close-modal');
  const cancelBtn = document.querySelector('.cancel-btn');
  const taskForm = document.getElementById('task-form');

  // Update UI based on current scheduler status
  function updateSchedulerUI() {
    const status = grokScheduler.getStatus();
    const schedule = grokScheduler.getSchedule();
    const history = grokScheduler.getJobHistory();

    // Update status indicator
    if (status.isActive) {
      toggleBtn.classList.add('active');
      schedulerStatus.textContent = 'Stop Scheduler';
      statusIndicator.textContent = 'Active';
      statusIndicator.classList.remove('inactive');
      statusIndicator.classList.add('active');
    } else {
      toggleBtn.classList.remove('active');
      schedulerStatus.textContent = 'Start Scheduler';
      statusIndicator.textContent = 'Inactive';
      statusIndicator.classList.remove('active');
      statusIndicator.classList.add('inactive');
    }

    // Update status details
    taskCount.textContent = schedule.length;
    currentOperation.textContent = status.currentJob ? status.currentJob.name : 'None';

    if (status.lastRun) {
      const lastRunDate = new Date(status.lastRun.completedAt);
      lastRun.textContent = `${lastRunDate.toLocaleDateString()} ${lastRunDate.toLocaleTimeString()}`;
    } else {
      lastRun.textContent = 'Never';
    }

    // Update scheduled tasks
    if (scheduledTasks) {
      scheduledTasks.innerHTML = '';

      if (schedule.length === 0) {
        const emptyRow = document.createElement('tr');
        emptyRow.innerHTML = `
          <td colspan="5" style="text-align: center;">No scheduled tasks</td>
        `;
        scheduledTasks.appendChild(emptyRow);
      } else {
        schedule.forEach(task => {
          const row = document.createElement('tr');

          // Format days
          const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
          const days = task.days.map(day => dayNames[day]).join(', ');

          // Format time
          const hour = task.hour.toString().padStart(2, '0');
          const minute = task.minute.toString().padStart(2, '0');

          // Action names
          const actionNames = {
            'analyze': 'Analyze Project',
            'suggest': 'Generate Suggestions',
            'prioritize': 'Prioritize Enhancements',
            'roadmap': 'Update Roadmap'
          };

          row.innerHTML = `
            <td>
              <div class="${task.enabled ? 'status-indicator active' : 'status-indicator inactive'}" style="display: inline-block; font-size: 12px;">
                ${task.enabled ? 'Enabled' : 'Disabled'}
              </div>
            </td>
            <td>${task.name}</td>
            <td>${actionNames[task.action] || task.action}</td>
            <td>${days} at ${hour}:${minute}</td>
            <td>
              <div class="task-actions">
                <button class="task-toggle ${task.enabled ? '' : 'disabled'}" data-id="${task.id}" title="${task.enabled ? 'Disable' : 'Enable'}">
                  <i class="fas ${task.enabled ? 'fa-toggle-on' : 'fa-toggle-off'}"></i>
                </button>
                <button class="task-edit" data-id="${task.id}" title="Edit">
                  <i class="fas fa-edit"></i>
                </button>
                <button class="task-delete" data-id="${task.id}" title="Delete">
                  <i class="fas fa-trash"></i>
                </button>
              </div>
            </td>
          `;

          scheduledTasks.appendChild(row);
        });

        // Add event listeners for task actions
        scheduledTasks.querySelectorAll('.task-toggle').forEach(btn => {
          btn.addEventListener('click', () => {
            const taskId = btn.getAttribute('data-id');
            grokScheduler.toggleTask(taskId);
            updateSchedulerUI();
          });
        });

        scheduledTasks.querySelectorAll('.task-edit').forEach(btn => {
          btn.addEventListener('click', () => {
            const taskId = btn.getAttribute('data-id');
            editTask(taskId);
          });
        });

        scheduledTasks.querySelectorAll('.task-delete').forEach(btn => {
          btn.addEventListener('click', () => {
            const taskId = btn.getAttribute('data-id');
            if (confirm('Are you sure you want to delete this task?')) {
              grokScheduler.removeTask(taskId);
              updateSchedulerUI();
            }
          });
        });
      }
    }

    // Update job history
    if (jobHistory) {
      jobHistory.innerHTML = '';

      if (history.length === 0) {
        const emptyRow = document.createElement('tr');
        emptyRow.innerHTML = `
          <td colspan="4" style="text-align: center;">No job history</td>
        `;
        jobHistory.appendChild(emptyRow);
      } else {
        // Sort history by start time (newest first)
        const sortedHistory = [...history].sort((a, b) => 
          new Date(b.startedAt) - new Date(a.startedAt)
        );

        sortedHistory.forEach(job => {
          const row = document.createElement('tr');

          const startTime = new Date(job.startedAt);

          // Action names
          const actionNames = {
            'analyze': 'Analyze Project',
            'suggest': 'Generate Suggestions',
            'prioritize': 'Prioritize Enhancements',
            'roadmap': 'Update Roadmap'
          };

          // Get action from task name (assuming format "Task Name - Action")
          const actionParts = job.name.split(' - ');
          const actionName = actionParts.length > 1 ? actionParts[1] : job.name;

          row.innerHTML = `
            <td>${job.name}</td>
            <td>${actionName}</td>
            <td>${startTime.toLocaleDateString()} ${startTime.toLocaleTimeString()}</td>
            <td>
              <div class="status-indicator ${job.status === 'completed' ? 'active' : 'inactive'}" style="display: inline-block; font-size: 12px;">
                ${job.status}
              </div>
            </td>
          `;

          jobHistory.appendChild(row);
        });
      }
    }
  }

  // Start/stop scheduler
  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      if (grokScheduler.isActive) {
        grokScheduler.stop();
      } else {
        grokScheduler.start();
      }
      updateSchedulerUI();
    });
  }

  // Open modal to add a new task
  if (addScheduleBtn) {
    addScheduleBtn.addEventListener('click', () => {
      // Reset form
      document.getElementById('task-id').value = '';
      document.getElementById('task-name').value = '';
      document.getElementById('task-action').value = 'analyze';
      document.getElementById('task-hour').value = '9';
      document.getElementById('task-minute').value = '0';

      // Set default weekdays
      const dayCheckboxes = document.querySelectorAll('input[name="days"]');
      dayCheckboxes.forEach(checkbox => {
        const day = parseInt(checkbox.value);
        checkbox.checked = day >= 1 && day <= 5; // Mon-Fri
      });

      // Update modal title
      document.getElementById('modal-title').textContent = 'Add Scheduled Task';

      // Show modal
      taskModal.classList.add('show');
    });
  }

  // Close modal
  if (closeModalBtn) {
    closeModalBtn.addEventListener('click', () => {
      taskModal.classList.remove('show');
    });
  }

  if (cancelBtn) {
    cancelBtn.addEventListener('click', () => {
      taskModal.classList.remove('show');
    });
  }

  // Handle form submission
  if (taskForm) {
    taskForm.addEventListener('submit', (e) => {
      e.preventDefault();

      // Get form values
      const taskId = document.getElementById('task-id').value;
      const name = document.getElementById('task-name').value;
      const action = document.getElementById('task-action').value;
      const hour = parseInt(document.getElementById('task-hour').value);
      const minute = parseInt(document.getElementById('task-minute').value);

      // Get selected days
      const days = [];
      document.querySelectorAll('input[name="days"]:checked').forEach(checkbox => {
        days.push(parseInt(checkbox.value));
      });

      // Create task object
      const taskData = {
        name,
        action,
        days,
        hour,
        minute,
        enabled: true
      };

      // Add or update task
      if (taskId) {
        grokScheduler.updateTask(taskId, taskData);
      } else {
        grokScheduler.addTask(taskData);
      }

      // Update UI
      updateSchedulerUI();

      // Close modal
      taskModal.classList.remove('show');
    });
  }

  // Edit task
  function editTask(taskId) {
    const task = grokScheduler.getSchedule().find(t => t.id === taskId);
    if (!task) return;

    // Fill form with task data
    document.getElementById('task-id').value = task.id;
    document.getElementById('task-name').value = task.name;
    document.getElementById('task-action').value = task.action;
    document.getElementById('task-hour').value = task.hour;
    document.getElementById('task-minute').value = task.minute;

    // Set day checkboxes
    document.querySelectorAll('input[name="days"]').forEach(checkbox => {
      const day = parseInt(checkbox.value);
      checkbox.checked = task.days.includes(day);
    });

    // Update modal title
    document.getElementById('modal-title').textContent = 'Edit Scheduled Task';

    // Show modal
    taskModal.classList.add('show');
  }

  // Make functions globally available
  window.updateSchedulerUI = updateSchedulerUI;
  window.updateChatUI = updateChatUI;

  // Initial UI update
  updateSchedulerUI();
}

// Initialize Grok Chat
function initGrokChat() {
  const chatMessages = document.getElementById('chat-messages');
  const chatInput = document.getElementById('chat-input');
  const sendMessageBtn = document.getElementById('send-message');
  const clearChatBtn = document.getElementById('clear-chat');
  const apiKeyInput = document.getElementById('api-key-input');
  const saveApiKeyBtn = document.getElementById('save-api-key');
  const autoImplementToggle = document.getElementById('auto-implement-toggle');

  console.log("Initializing Grok Chat component");

  // Show loading indicator during initialization
  if (chatMessages) {
    chatMessages.innerHTML = `
      <div class="loading-indicator">
        <div class="spinner"></div>
        <p>Loading Grok Chat...</p>
      </div>
    `;
  }

  // Add basic loading styles
  const style = document.createElement('style');
  style.textContent = `
    .loading-indicator {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .spinner {
      width: 40px;
      height: 40px;
      border: 4px solid rgba(74, 110, 245, 0.1);
      border-left-color: var(--primary-dev-color);
      border-radius: 50%;
      animation: spin 1s linear infinite;
    }
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
  `;
  document.head.appendChild(style);

  // Initialize chat
  try {
    grokChat.initialize();
  } catch (error) {
    console.error("Error initializing Grok Chat:", error);
    if (chatMessages) {
      chatMessages.innerHTML = `
        <div class="error-message" style="color: #f44336; padding: 20px; text-align: center;">
          <i class="fas fa-exclamation-triangle" style="font-size: 24px; margin-bottom: 10px;"></i>
          <p>Failed to initialize Grok Chat. Please try refreshing the page.</p>
          <p style="font-size: 12px; color: #666;">${error.message || "Unknown error"}</p>
        </div>
      `;
    }
  }

  // Set up auto-implement toggle
  if (autoImplementToggle) {
    // Load saved preference (default to true if not set)
    const autoImplementEnabled = localStorage.getItem('grok_auto_implement') !== 'false';
    autoImplementToggle.checked = autoImplementEnabled;

    // Update when toggle changes
    autoImplementToggle.addEventListener('change', () => {
      localStorage.setItem('grok_auto_implement', autoImplementToggle.checked);
      console.log(`Auto-implement code changes: ${autoImplementToggle.checked ? 'enabled' : 'disabled'}`);
    });

    // Make available to grokChat
    grokChat.autoImplementEnabled = autoImplementEnabled;
  }

  // Define the send message function
  function sendMessage() {
    const message = chatInput.value.trim();
    if (!message) return;

    console.log('Sending message to Grok:', message);

    // Reset input
    chatInput.value = '';

    try {
      // Send to Grok
      grokChat.sendMessage(message);
    } catch (error) {
      console.error("Error sending message:", error);
    }
  }

  // API key handling for X API
  if (saveApiKeyBtn && apiKeyInput) {
    // Check for existing API key
    const savedApiKey = localStorage.getItem('x_api_key');
    if (savedApiKey) {
      apiKeyInput.value = '••••••••••••••••••••••••••';
    }

    // Save API key with proper validation and enhanced UX
    saveApiKeyBtn.addEventListener('click', () => {
      // Initialize notifications
      grokNotifications.initialize();

            const apiKey = apiKeyInput.value.trim();
      if (apiKey) {
        // X API keys should generally be alphanumeric with possible hyphens/underscores
        if (!/^[a-zA-Z0-9\-_]+$/.test(apiKey)) {
          grokNotifications.warning(
            'Your API key contains invalid characters. API keys typically only contain letters, numbers, hyphens and underscores.',
            'Invalid API Key Format'
          );

          // Clean the API key and show a confirmation dialog
          const cleanedKey = apiKey.replace(/[^\x20-\x7E]/g, "");

          // Create a custom dialog instead of using confirm()
          const dialog = document.createElement('div');
          dialog.className = 'api-key-dialog';
          dialog.innerHTML = `
            <div class="api-key-dialog-content">
              <h3>Invalid API Key Format</h3>
              <p>Would you like to save a cleaned version of your API key instead? This will remove any potentially problematic characters.</p>
              <div class="dialog-buttons">
                <button class="dialog-btn cancel-btn">Cancel</button>
                <button class="dialog-btn confirm-btn">Use Cleaned Key</button>
              </div>
            </div>
          `;

          // Add styles
          const dialogStyle = document.createElement('style');
          dialogStyle.textContent = `
            .api-key-dialog {
              position: fixed;
              top: 0;
              left: 0;
              width: 100%;
              height: 100%;
              background-color: rgba(0, 0, 0, 0.5);
              display: flex;
              align-items: center;
              justify-content: center;
              z-index: 10000;
            }

            .api-key-dialog-content {
              background-color: white;
              border-radius: 8px;
              padding: 20px;
              max-width: 400px;
              width: 90%;
              box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
            }

            .dialog-buttons {
              display: flex;
              justify-content: flex-end;
              gap: 10px;
              margin-top: 20px;
            }

            .dialog-btn {
              padding: 8px 16px;
              border-radius: 4px;
              cursor: pointer;
              font-weight: 500;
            }

            .cancel-btn {
              background-color: #f5f5f5;
              border: 1px solid #ddd;
              color: #333;
            }

            .confirm-btn {
              background-color: var(--primary-dev-color);
              border: none;
              color: white;
            }
          `;

          document.head.appendChild(dialogStyle);
          document.body.appendChild(dialog);

          // Add event listeners
          dialog.querySelector('.cancel-btn').addEventListener('click', () => {
            document.body.removeChild(dialog);
          });

          dialog.querySelector('.confirm-btn').addEventListener('click', () => {
            localStorage.setItem('x_api_key', cleanedKey);
            apiKeyInput.value = '••••••••••••••••••••••••••';
            document.body.removeChild(dialog);

            grokNotifications.success(
              'Cleaned API key saved successfully! You can now chat with the real Grok AI.',
              'API Key Saved'
            );

            // Clear existing chat history to start fresh with new API key
            if (grokChat && typeof grokChat.clearHistory === 'function') {
              grokChat.clearHistory();
            }

            console.log("Cleaned API key saved");
          });

          return;
        }

        // Store the key exactly as entered without modification
        localStorage.setItem('x_api_key', apiKey);
        apiKeyInput.value = '••••••••••••••••••••••••••';

        grokNotifications.success(
          'API key saved successfully! You can now chat with the real Grok AI.',
          'API Key Saved'
        );

        // Clear existing chat history to start fresh with new API key
        if (grokChat && typeof grokChat.clearHistory === 'function') {
          grokChat.clearHistory();
        }

        console.log("API key saved and ready to use with X Grok API");
      } else {
        grokNotifications.error('Please enter a valid API key.', 'Invalid Input');
      }
    });
  }

  // Update UI with existing messages
  if (typeof grokChat.updateChatUI === 'function') {
    grokChat.updateChatUI();
  } else {
    console.error("updateChatUI function is not available on grokChat");
  }

  // Make sure updateChatUI is globally accessible
  window.updateChatUI = function(thinkingMessage) {
    if (grokChat && typeof grokChat.updateChatUI === 'function') {
      grokChat.updateChatUI(thinkingMessage);
    } else {
      console.error("Could not update chat UI - function not available");
    }
  };

  // Event listeners - using direct onclick to avoid issues
  if (sendMessageBtn) {
    sendMessageBtn.onclick = sendMessage;
    console.log('Send message button listener added via onclick');
  } else {
    console.error("Send message button not found");
  }

  if (chatInput) {
    chatInput.onkeypress = (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    };
    console.log('Chat input listener added via onkeypress');
  } else {
    console.error("Chat input not found");
  }

  // Add event listener for clear chat button
  if (clearChatBtn) {
    clearChatBtn.onclick = () => {
      grokChat.clearHistory();
    };
  } else {
    console.error("Clear chat button not found");
  }
}

// Initialize dashboard
document.addEventListener('DOMContentLoaded', () => {
  try {
    initDashboard();
    initScheduler();
    initGrokChat();

    // Set initial active section
    document.querySelector('[data-section="overview"]').classList.add('active');
    document.getElementById('overview').classList.add('active-section');

    console.log("Developer dashboard initialized successfully");
  } catch (error) {
    console.error("Error initializing dashboard:", error);
  }
});