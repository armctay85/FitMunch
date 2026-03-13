
// Grok Scheduler - Autonomous developer actions on schedule
import grokDeveloper from './grok_developer.js';

class GrokScheduler {
  constructor() {
    this.isActive = false;
    this.schedule = [];
    this.currentJob = null;
    this.jobHistory = [];
    this.checkInterval = null;
  }

  // Initialize the scheduler
  initialize() {
    // Load saved schedule from localStorage if available
    const savedSchedule = localStorage.getItem('grokSchedule');
    if (savedSchedule) {
      this.schedule = JSON.parse(savedSchedule);
    }
    
    // Check if scheduler was active before page refresh
    const wasActive = localStorage.getItem('grokSchedulerActive') === 'true';
    if (wasActive) {
      this.start();
    }
    
    console.log('Grok Scheduler initialized');
    return this;
  }
  
  // Start the scheduler
  start() {
    if (this.isActive) return;
    
    this.isActive = true;
    localStorage.setItem('grokSchedulerActive', 'true');
    
    // Check for scheduled tasks every minute
    this.checkInterval = setInterval(() => {
      this.checkSchedule();
    }, 60000);
    
    // Run initial check immediately
    this.checkSchedule();
    
    console.log('Grok Scheduler started');
    return this;
  }
  
  // Stop the scheduler
  stop() {
    if (!this.isActive) return;
    
    this.isActive = false;
    localStorage.setItem('grokSchedulerActive', 'false');
    
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    
    console.log('Grok Scheduler stopped');
    return this;
  }
  
  // Check if any scheduled tasks should run
  checkSchedule() {
    if (!this.isActive || this.schedule.length === 0) return;
    
    const now = new Date();
    const dayOfWeek = now.getDay(); // 0-6 (Sunday-Saturday)
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    
    // Find tasks that should run at this time
    this.schedule.forEach(task => {
      if (
        task.enabled &&
        task.days.includes(dayOfWeek) &&
        task.hour === currentHour &&
        task.minute === currentMinute &&
        !this.isTaskRunningOrRecentlyRun(task.id)
      ) {
        this.runTask(task);
      }
    });
  }
  
  // Check if a task is currently running or has run recently (to prevent duplicates)
  isTaskRunningOrRecentlyRun(taskId) {
    // Check if task is currently running
    if (this.currentJob && this.currentJob.taskId === taskId) {
      return true;
    }
    
    // Check if task has run in the last 2 minutes (to avoid double-runs)
    const recentRun = this.jobHistory.find(job => 
      job.taskId === taskId && 
      (new Date() - new Date(job.completedAt)) < 120000
    );
    
    return !!recentRun;
  }
  
  // Run a specific scheduled task
  runTask(task) {
    console.log(`Running scheduled Grok task: ${task.name}`);
    
    this.currentJob = {
      taskId: task.id,
      name: task.name,
      startedAt: new Date(),
      status: 'running'
    };
    
    // Perform the specified action
    let result;
    switch (task.action) {
      case 'analyze':
        result = grokDeveloper.analyzeProject();
        break;
      case 'suggest':
        result = grokDeveloper.generateEnhancementSuggestions();
        break;
      case 'prioritize':
        result = grokDeveloper.prioritizeEnhancements();
        break;
      case 'roadmap':
        result = grokDeveloper.generateRoadmap();
        break;
      default:
        result = { error: 'Unknown action type' };
    }
    
    // Complete the job
    this.currentJob.completedAt = new Date();
    this.currentJob.result = result;
    this.currentJob.status = 'completed';
    
    // Save to history
    this.jobHistory.push({...this.currentJob});
    
    // Limit history to 50 items
    if (this.jobHistory.length > 50) {
      this.jobHistory = this.jobHistory.slice(-50);
    }
    
    // Clear current job
    this.currentJob = null;
    
    // Trigger UI update if we're on the developer dashboard
    if (typeof updateSchedulerUI === 'function') {
      updateSchedulerUI();
    }
    
    return result;
  }
  
  // Add a new scheduled task
  addTask(task) {
    // Generate an ID if not provided
    if (!task.id) {
      task.id = 'task_' + Date.now();
    }
    
    // Ensure task has all required properties
    const newTask = {
      id: task.id,
      name: task.name || 'Unnamed Task',
      action: task.action || 'analyze',
      days: task.days || [1, 2, 3, 4, 5], // Default to weekdays
      hour: task.hour !== undefined ? task.hour : 9, // Default to 9 AM
      minute: task.minute !== undefined ? task.minute : 0,
      enabled: task.enabled !== undefined ? task.enabled : true,
      createdAt: new Date()
    };
    
    this.schedule.push(newTask);
    this.saveSchedule();
    
    return newTask;
  }
  
  // Remove a scheduled task
  removeTask(taskId) {
    const initialLength = this.schedule.length;
    this.schedule = this.schedule.filter(task => task.id !== taskId);
    
    if (this.schedule.length !== initialLength) {
      this.saveSchedule();
      return true;
    }
    
    return false;
  }
  
  // Update an existing task
  updateTask(taskId, updates) {
    const taskIndex = this.schedule.findIndex(task => task.id === taskId);
    if (taskIndex === -1) {
      return false;
    }
    
    this.schedule[taskIndex] = {
      ...this.schedule[taskIndex],
      ...updates,
      updatedAt: new Date()
    };
    
    this.saveSchedule();
    return this.schedule[taskIndex];
  }
  
  // Toggle a task's enabled status
  toggleTask(taskId) {
    const taskIndex = this.schedule.findIndex(task => task.id === taskId);
    if (taskIndex === -1) {
      return false;
    }
    
    this.schedule[taskIndex].enabled = !this.schedule[taskIndex].enabled;
    this.saveSchedule();
    
    return this.schedule[taskIndex];
  }
  
  // Save schedule to localStorage
  saveSchedule() {
    localStorage.setItem('grokSchedule', JSON.stringify(this.schedule));
  }
  
  // Get the full schedule
  getSchedule() {
    return this.schedule;
  }
  
  // Get job history
  getJobHistory() {
    return this.jobHistory;
  }
  
  // Get scheduler status
  getStatus() {
    return {
      isActive: this.isActive,
      taskCount: this.schedule.length,
      currentJob: this.currentJob,
      lastRun: this.jobHistory.length > 0 ? this.jobHistory[this.jobHistory.length - 1] : null
    };
  }
}

// Create and export the scheduler instance
const grokScheduler = new GrokScheduler();

// Initialize on DOM content loaded
document.addEventListener('DOMContentLoaded', () => {
  grokScheduler.initialize();
});

export default grokScheduler;
