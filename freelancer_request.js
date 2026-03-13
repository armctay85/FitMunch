
// Freelancer Request Form Handler

document.addEventListener('DOMContentLoaded', function() {
  // Initialize form handlers
  initializeForm();
  
  // Initialize tabs if they exist
  const tabs = document.querySelectorAll('.tab-button');
  if (tabs.length) {
    initializeTabs();
  }
});

function initializeForm() {
  const requestForm = document.getElementById('freelancer-request-form');
  
  if (requestForm) {
    requestForm.addEventListener('submit', function(e) {
      e.preventDefault();
      
      // Get form values
      const name = document.getElementById('freelancer-name').value;
      const email = document.getElementById('freelancer-email').value;
      const expertise = document.getElementById('freelancer-expertise').value;
      const budget = document.getElementById('budget-range').value;
      const timeline = document.getElementById('timeline').value;
      const message = document.getElementById('freelancer-message').value;
      
      // Validate form
      if (!name || !email || !expertise) {
        showFormError('Please fill in all required fields.');
        return;
      }
      
      // Create request object
      const request = {
        name,
        email,
        expertise,
        budget,
        timeline,
        message,
        date: new Date().toISOString(),
        project: 'FitMunch App - Google Play Store Submission',
        status: 'pending'
      };
      
      // Save request (in a real app, this would be sent to a server)
      saveFreelancerRequest(request);
      
      // Show success message
      showFormSuccess('Your request has been submitted! We will connect you with qualified freelancers soon.');
      
      // Reset form
      requestForm.reset();
    });
    
    // Initialize budget range display
    const budgetRange = document.getElementById('budget-range');
    const budgetDisplay = document.getElementById('budget-display');
    
    if (budgetRange && budgetDisplay) {
      // Set initial display
      budgetDisplay.textContent = `$${budgetRange.value}`;
      
      // Update on change
      budgetRange.addEventListener('input', function() {
        budgetDisplay.textContent = `$${this.value}`;
      });
    }
  }
}

function initializeTabs() {
  const tabButtons = document.querySelectorAll('.tab-button');
  const tabContents = document.querySelectorAll('.tab-content');
  
  tabButtons.forEach(button => {
    button.addEventListener('click', function() {
      // Remove active class from all buttons and contents
      tabButtons.forEach(btn => btn.classList.remove('active'));
      tabContents.forEach(content => content.classList.remove('active'));
      
      // Add active class to clicked button
      this.classList.add('active');
      
      // Show corresponding content
      const tabId = this.getAttribute('data-tab');
      const tabContent = document.getElementById(tabId);
      
      if (tabContent) {
        tabContent.classList.add('active');
      }
    });
  });
  
  // Activate first tab by default
  if (tabButtons.length > 0) {
    tabButtons[0].click();
  }
}

function showFormError(message) {
  const errorElement = document.getElementById('form-error');
  
  if (errorElement) {
    errorElement.textContent = message;
    errorElement.style.display = 'block';
    
    // Hide after 5 seconds
    setTimeout(() => {
      errorElement.style.display = 'none';
    }, 5000);
  } else {
    alert(`Error: ${message}`);
  }
}

function showFormSuccess(message) {
  const successElement = document.getElementById('form-success');
  
  if (successElement) {
    successElement.textContent = message;
    successElement.style.display = 'block';
    
    // Hide after 5 seconds
    setTimeout(() => {
      successElement.style.display = 'none';
    }, 5000);
  } else {
    alert(`Success: ${message}`);
  }
}

function saveFreelancerRequest(request) {
  // In a real app, this would send data to a server
  console.log('Saving freelancer request:', request);
  
  // For demo purposes, store in localStorage
  let requests = JSON.parse(localStorage.getItem('freelancerRequests') || '[]');
  requests.push(request);
  localStorage.setItem('freelancerRequests', JSON.stringify(requests));
  
  // Update request count badge if it exists
  updateRequestCountBadge();
}

function updateRequestCountBadge() {
  const badge = document.getElementById('request-count-badge');
  
  if (badge) {
    const requests = JSON.parse(localStorage.getItem('freelancerRequests') || '[]');
    badge.textContent = requests.length;
    
    if (requests.length > 0) {
      badge.style.display = 'inline-block';
    } else {
      badge.style.display = 'none';
    }
  }
}

// Functions for the dashboard
function loadFreelancerRequests() {
  const requestsContainer = document.getElementById('freelancer-requests');
  
  if (requestsContainer) {
    const requests = JSON.parse(localStorage.getItem('freelancerRequests') || '[]');
    
    if (requests.length === 0) {
      requestsContainer.innerHTML = '<p class="empty-state">No freelancer requests yet.</p>';
      return;
    }
    
    let html = '';
    
    requests.forEach((request, index) => {
      const date = new Date(request.date).toLocaleDateString();
      
      html += `
        <div class="request-card">
          <div class="request-header">
            <h3>${request.name}</h3>
            <span class="request-date">${date}</span>
          </div>
          <div class="request-details">
            <p><strong>Email:</strong> ${request.email}</p>
            <p><strong>Expertise:</strong> ${request.expertise}</p>
            <p><strong>Budget:</strong> $${request.budget}</p>
            <p><strong>Timeline:</strong> ${request.timeline}</p>
            <p><strong>Message:</strong> ${request.message}</p>
          </div>
          <div class="request-actions">
            <button class="approve-btn" onclick="approveRequest(${index})">Approve</button>
            <button class="reject-btn" onclick="rejectRequest(${index})">Reject</button>
          </div>
        </div>
      `;
    });
    
    requestsContainer.innerHTML = html;
  }
}

function approveRequest(index) {
  const requests = JSON.parse(localStorage.getItem('freelancerRequests') || '[]');
  
  if (index >= 0 && index < requests.length) {
    requests[index].status = 'approved';
    localStorage.setItem('freelancerRequests', JSON.stringify(requests));
    
    // Reload requests
    loadFreelancerRequests();
  }
}

function rejectRequest(index) {
  const requests = JSON.parse(localStorage.getItem('freelancerRequests') || '[]');
  
  if (index >= 0 && index < requests.length) {
    requests[index].status = 'rejected';
    localStorage.setItem('freelancerRequests', JSON.stringify(requests));
    
    // Reload requests
    loadFreelancerRequests();
  }
}

// Export functions for use in HTML
window.saveFreelancerRequest = saveFreelancerRequest;
window.loadFreelancerRequests = loadFreelancerRequests;
window.approveRequest = approveRequest;
window.rejectRequest = rejectRequest;
