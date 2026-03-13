
// Advanced workout plan generator for FitMunch
window.generateActivityPlan = function() {
  console.log("Generating comprehensive activity plan");
  
  // Only proceed if workout section exists
  const workoutSection = document.getElementById('workout');
  if (!workoutSection) {
    console.warn("Workout section not found");
    return;
  }

  // Get user's activity plan preferences
  const userProfile = JSON.parse(localStorage.getItem('userProfile')) || {};
  const activityPlan = userProfile.goals?.activityPlan || {
    type: 'gym',
    frequency: 3,
    level: 'Beginner',
    duration: 1,
    preferredTime: 'Morning (6-9)'
  };

  console.log("Activity plan:", activityPlan);

  // Generate workouts based on type and level
  let workouts = [];

  if (activityPlan.type === 'gym') {
    if (activityPlan.level === 'Beginner') {
      workouts = [
        {
          day: 'Monday',
          workout: 'Full Body Foundation',
          exercises: [
            { name: 'Bodyweight Squats', sets: 3, reps: '10-12', rest: '60s', notes: 'Focus on form' },
            { name: 'Push-ups (modified if needed)', sets: 3, reps: '5-10', rest: '60s', notes: 'Start with wall/incline if needed' },
            { name: 'Dumbbell Rows', sets: 3, reps: '8-10', rest: '60s', notes: 'Light weight, focus on back squeeze' },
            { name: 'Plank', sets: 3, time: '20-30s', rest: '45s', notes: 'Keep body straight' },
            { name: 'Glute Bridges', sets: 3, reps: '12-15', rest: '45s', notes: 'Squeeze glutes at top' }
          ],
          duration: activityPlan.duration,
          intensity: 'Light to Moderate',
          focusAreas: ['Full Body', 'Foundation Building', 'Form Learning']
        },
        {
          day: 'Wednesday',
          workout: 'Cardio & Core',
          exercises: [
            { name: 'Treadmill Walk/Jog', sets: 1, time: '15-20 min', rest: 'N/A', notes: 'Start slow, build endurance' },
            { name: 'Bicycle Crunches', sets: 3, reps: '10 each side', rest: '45s', notes: 'Slow and controlled' },
            { name: 'Mountain Climbers', sets: 3, time: '20s', rest: '40s', notes: 'Keep hips stable' },
            { name: 'Russian Twists', sets: 3, reps: '15', rest: '45s', notes: 'Use bodyweight first' },
            { name: 'Walking', sets: 1, time: '10 min', rest: 'N/A', notes: 'Cool down pace' }
          ],
          duration: activityPlan.duration,
          intensity: 'Moderate',
          focusAreas: ['Cardiovascular Health', 'Core Strength', 'Endurance']
        },
        {
          day: 'Friday',
          workout: 'Strength & Flexibility',
          exercises: [
            { name: 'Goblet Squats', sets: 3, reps: '8-12', rest: '60s', notes: 'Light dumbbell' },
            { name: 'Incline Push-ups', sets: 3, reps: '8-12', rest: '60s', notes: 'Use bench or step' },
            { name: 'Lat Pulldowns', sets: 3, reps: '10-12', rest: '60s', notes: 'Light weight, focus on form' },
            { name: 'Side Plank', sets: 3, time: '15s each side', rest: '30s', notes: 'Modify on knees if needed' },
            { name: 'Stretching Routine', sets: 1, time: '10 min', rest: 'N/A', notes: 'Full body stretch' }
          ],
          duration: activityPlan.duration,
          intensity: 'Moderate',
          focusAreas: ['Strength Building', 'Flexibility', 'Balance']
        }
      ];
    } else if (activityPlan.level === 'Intermediate') {
      workouts = [
        {
          day: 'Monday',
          workout: 'Upper Body Push',
          exercises: [
            { name: 'Bench Press', sets: 4, reps: '8-10', rest: '90s', notes: 'Progressive overload' },
            { name: 'Shoulder Press', sets: 4, reps: '8-10', rest: '90s', notes: 'Control the weight' },
            { name: 'Incline Dumbbell Press', sets: 3, reps: '10-12', rest: '75s', notes: '45-degree angle' },
            { name: 'Lateral Raises', sets: 3, reps: '12-15', rest: '60s', notes: 'Light weight, focus on form' },
            { name: 'Tricep Dips', sets: 3, reps: '10-15', rest: '60s', notes: 'Use bench or chair' },
            { name: 'Diamond Push-ups', sets: 3, reps: '8-12', rest: '60s', notes: 'Target triceps' }
          ],
          duration: activityPlan.duration,
          intensity: 'Moderate to High',
          focusAreas: ['Chest', 'Shoulders', 'Triceps', 'Upper Body Power']
        },
        {
          day: 'Tuesday',
          workout: 'Lower Body',
          exercises: [
            { name: 'Squats', sets: 4, reps: '10-12', rest: '120s', notes: 'Full depth, control ascent' },
            { name: 'Romanian Deadlifts', sets: 4, reps: '8-10', rest: '120s', notes: 'Hip hinge movement' },
            { name: 'Walking Lunges', sets: 3, reps: '12 each leg', rest: '90s', notes: 'Step into lunge' },
            { name: 'Leg Press', sets: 3, reps: '12-15', rest: '90s', notes: 'Control the negative' },
            { name: 'Calf Raises', sets: 4, reps: '15-20', rest: '60s', notes: 'Full range of motion' },
            { name: 'Leg Curls', sets: 3, reps: '12-15', rest: '60s', notes: 'Squeeze hamstrings' }
          ],
          duration: activityPlan.duration,
          intensity: 'High',
          focusAreas: ['Quadriceps', 'Hamstrings', 'Glutes', 'Lower Body Power']
        },
        {
          day: 'Thursday',
          workout: 'Upper Body Pull',
          exercises: [
            { name: 'Pull-ups/Lat Pulldowns', sets: 4, reps: '6-10', rest: '90s', notes: 'Full range of motion' },
            { name: 'Barbell Rows', sets: 4, reps: '8-10', rest: '90s', notes: 'Squeeze shoulder blades' },
            { name: 'Face Pulls', sets: 3, reps: '15', rest: '60s', notes: 'External rotation focus' },
            { name: 'Hammer Curls', sets: 3, reps: '10-12', rest: '60s', notes: 'Control the weight' },
            { name: 'Barbell Curls', sets: 3, reps: '8-10', rest: '60s', notes: 'No swinging' },
            { name: 'Reverse Flyes', sets: 3, reps: '12-15', rest: '60s', notes: 'Target rear delts' }
          ],
          duration: activityPlan.duration,
          intensity: 'Moderate to High',
          focusAreas: ['Back', 'Biceps', 'Rear Delts', 'Posture']
        },
        {
          day: 'Saturday',
          workout: 'Core & Conditioning',
          exercises: [
            { name: 'HIIT Circuit', sets: 5, work: '30s', rest: '30s', notes: 'Burpees, mountain climbers, jumping jacks' },
            { name: 'Plank Variations', sets: 4, time: '30-45s', rest: '30s', notes: 'Front, side, with leg lifts' },
            { name: 'Russian Twists', sets: 3, reps: '20', rest: '45s', notes: 'Add weight if possible' },
            { name: 'Dead Bug', sets: 3, reps: '10 each side', rest: '45s', notes: 'Keep core engaged' },
            { name: 'Hanging Leg Raises', sets: 3, reps: '8-12', rest: '60s', notes: 'Control the swing' },
            { name: 'Foam Rolling', sets: 1, time: '10 min', rest: 'N/A', notes: 'Full body recovery' }
          ],
          duration: activityPlan.duration,
          intensity: 'High',
          focusAreas: ['Core Strength', 'Conditioning', 'Recovery', 'Flexibility']
        }
      ];
    } else if (activityPlan.level === 'Advanced') {
      workouts = [
        {
          day: 'Monday',
          workout: 'Heavy Push Day',
          exercises: [
            { name: 'Barbell Bench Press', sets: 5, reps: '5', rest: '3 min', notes: '80-85% 1RM' },
            { name: 'Overhead Press', sets: 5, reps: '5', rest: '3 min', notes: 'Strict form, no leg drive' },
            { name: 'Weighted Dips', sets: 4, reps: '6-8', rest: '2 min', notes: 'Add weight as possible' },
            { name: 'Incline Dumbbell Press', sets: 4, reps: '8-10', rest: '90s', notes: 'Squeeze at top' },
            { name: 'Lateral Raise Circuit', sets: 3, reps: '15/12/10', rest: '45s', notes: 'Drop set pattern' },
            { name: 'Close-Grip Bench Press', sets: 3, reps: '8-10', rest: '90s', notes: 'Target triceps' }
          ],
          duration: activityPlan.duration,
          intensity: 'Very High',
          focusAreas: ['Strength', 'Power', 'Chest', 'Shoulders', 'Triceps']
        },
        {
          day: 'Tuesday',
          workout: 'Heavy Pull Day',
          exercises: [
            { name: 'Deadlifts', sets: 5, reps: '5', rest: '3 min', notes: '80-85% 1RM, perfect form' },
            { name: 'Weighted Pull-ups', sets: 4, reps: '6-8', rest: '2 min', notes: 'Add weight as possible' },
            { name: 'Barbell Rows', sets: 4, reps: '6-8', rest: '2 min', notes: 'Heavy, strict form' },
            { name: 'T-Bar Rows', sets: 3, reps: '8-10', rest: '90s', notes: 'Squeeze at contraction' },
            { name: 'Weighted Chin-ups', sets: 3, reps: '8-10', rest: '90s', notes: 'Supinated grip' },
            { name: 'Barbell Curls', sets: 4, reps: '8-10', rest: '75s', notes: 'Focus on eccentric' }
          ],
          duration: activityPlan.duration,
          intensity: 'Very High',
          focusAreas: ['Strength', 'Power', 'Back', 'Biceps', 'Posterior Chain']
        },
        {
          day: 'Wednesday',
          workout: 'Active Recovery',
          exercises: [
            { name: 'Light Cardio', sets: 1, time: '20-30 min', rest: 'N/A', notes: 'Zone 2 heart rate' },
            { name: 'Dynamic Stretching', sets: 1, time: '15 min', rest: 'N/A', notes: 'Full body mobility' },
            { name: 'Foam Rolling', sets: 1, time: '15 min', rest: 'N/A', notes: 'Target tight areas' },
            { name: 'Core Activation', sets: 3, reps: '15', rest: '30s', notes: 'Bird dogs, dead bugs' },
            { name: 'Band Pull-aparts', sets: 3, reps: '20', rest: '30s', notes: 'Shoulder health' }
          ],
          duration: activityPlan.duration * 0.7,
          intensity: 'Light',
          focusAreas: ['Recovery', 'Mobility', 'Blood Flow', 'Injury Prevention']
        },
        {
          day: 'Thursday',
          workout: 'Heavy Legs',
          exercises: [
            { name: 'Back Squats', sets: 5, reps: '5', rest: '3 min', notes: '80-85% 1RM, full depth' },
            { name: 'Romanian Deadlifts', sets: 4, reps: '6-8', rest: '2 min', notes: 'Feel hamstring stretch' },
            { name: 'Bulgarian Split Squats', sets: 4, reps: '8 each leg', rest: '90s', notes: 'Rear foot elevated' },
            { name: 'Walking Lunges', sets: 3, reps: '12 each leg', rest: '90s', notes: 'Add weight if possible' },
            { name: 'Leg Curls', sets: 4, reps: '10-12', rest: '75s', notes: 'Squeeze and hold' },
            { name: 'Calf Raises', sets: 5, reps: '15', rest: '60s', notes: 'Pause at top' }
          ],
          duration: activityPlan.duration,
          intensity: 'Very High',
          focusAreas: ['Strength', 'Power', 'Quadriceps', 'Hamstrings', 'Glutes']
        },
        {
          day: 'Friday',
          workout: 'Hypertrophy Upper',
          exercises: [
            { name: 'Incline Bench Press', sets: 4, reps: '10-12', rest: '90s', notes: 'Tempo: 3-1-1-1' },
            { name: 'Cable Rows', sets: 4, reps: '12-15', rest: '90s', notes: 'Squeeze and hold' },
            { name: 'Dumbbell Shoulder Press', sets: 4, reps: '10-12', rest: '75s', notes: 'Full range of motion' },
            { name: 'Lat Pulldowns', sets: 4, reps: '12-15', rest: '75s', notes: 'Wide grip, lean back' },
            { name: 'Cable Flyes', sets: 3, reps: '15', rest: '60s', notes: 'Focus on stretch' },
            { name: 'Cable Curls Superset', sets: 3, reps: '12+12', rest: '90s', notes: 'Hammer + bicep curls' }
          ],
          duration: activityPlan.duration,
          intensity: 'High',
          focusAreas: ['Hypertrophy', 'Muscle Endurance', 'Definition', 'Volume']
        },
        {
          day: 'Saturday',
          workout: 'Conditioning & Power',
          exercises: [
            { name: 'Circuit Training', sets: 6, work: '45s', rest: '15s', notes: 'Battle ropes, box jumps, burpees' },
            { name: 'Olympic Lift Practice', sets: 5, reps: '3', rest: '2 min', notes: 'Power cleans or snatches' },
            { name: 'Plyometric Circuit', sets: 4, reps: '8', rest: '90s', notes: 'Jump squats, explosive push-ups' },
            { name: 'Farmer\'s Walks', sets: 4, distance: '40m', rest: '90s', notes: 'Heavy dumbbells' },
            { name: 'Weighted Carries', sets: 3, distance: '30m', rest: '90s', notes: 'Overhead, front rack, suitcase' },
            { name: 'Cool Down Yoga', sets: 1, time: '15 min', rest: 'N/A', notes: 'Focus on tight areas' }
          ],
          duration: activityPlan.duration,
          intensity: 'Very High',
          focusAreas: ['Power', 'Conditioning', 'Explosiveness', 'Work Capacity']
        }
      ];
    }
  }

  // Default workout if no specific plan
  if (workouts.length === 0) {
    workouts = [
      {
        day: 'Monday',
        workout: 'Full Body Workout',
        exercises: [
          { name: 'Squats', sets: 3, reps: '12', rest: '60s', notes: 'Focus on form' },
          { name: 'Push-ups', sets: 3, reps: '10', rest: '60s', notes: 'Modify as needed' },
          { name: 'Rows', sets: 3, reps: '10', rest: '60s', notes: 'Squeeze shoulder blades' },
          { name: 'Plank', sets: 3, time: '30s', rest: '30s', notes: 'Keep straight line' }
        ],
        duration: 1,
        intensity: 'Moderate',
        focusAreas: ['Full Body', 'Strength', 'Endurance']
      },
      {
        day: 'Wednesday',
        workout: 'Cardio Day',
        exercises: [
          { name: 'Walking/Jogging', sets: 1, time: '20 min', rest: 'N/A', notes: 'Steady pace' },
          { name: 'Jumping Jacks', sets: 3, reps: '20', rest: '30s', notes: 'Full body movement' },
          { name: 'Mountain Climbers', sets: 3, time: '30s', rest: '30s', notes: 'Keep hips stable' }
        ],
        duration: 1,
        intensity: 'Moderate',
        focusAreas: ['Cardiovascular', 'Endurance']
      },
      {
        day: 'Friday',
        workout: 'Strength Training',
        exercises: [
          { name: 'Lunges', sets: 3, reps: '10 each', rest: '60s', notes: 'Control the movement' },
          { name: 'Incline Push-ups', sets: 3, reps: '12', rest: '60s', notes: 'Use bench or step' },
          { name: 'Glute Bridges', sets: 3, reps: '15', rest: '45s', notes: 'Squeeze glutes' }
        ],
        duration: 1,
        intensity: 'Moderate',
        focusAreas: ['Strength', 'Stability']
      }
    ];
  }

  // Display the workout plan
  displayWorkoutPlan(workouts, activityPlan);
  console.log("Activity plan generated successfully");
};

function displayWorkoutPlan(workouts, activityPlan) {
  const workoutPlanDisplay = document.getElementById('workoutPlanDisplay');
  if (!workoutPlanDisplay) {
    console.error("Workout plan display element not found");
    return;
  }

  // Initialize workout history if it doesn't exist
  if (!window.workoutHistory) {
    window.workoutHistory = JSON.parse(localStorage.getItem('workoutHistory') || '{}');
  }

  let planHTML = `
    <div class="plan-header">
      <h3>${activityPlan.level} ${activityPlan.type.charAt(0).toUpperCase() + activityPlan.type.slice(1)} Program</h3>
      <p>Weekly Frequency: ${workouts.length} days | Duration: ${activityPlan.duration} hour${activityPlan.duration > 1 ? 's' : ''}/session</p>
    </div>
    <div class="workouts-container">
  `;

  workouts.forEach(workout => {
    const isCompleted = window.workoutHistory[workout.day] && window.workoutHistory[workout.day].completed;

    planHTML += `
      <div class="workout-card ${isCompleted ? 'workout-completed' : ''}">
        <div class="workout-day">${workout.day}</div>
        <div class="workout-title">${workout.workout}</div>
        <div class="workout-meta">
          <span class="workout-time"><i class="fas fa-clock"></i> ${workout.duration} hour${workout.duration !== 1 ? 's' : ''}</span>
          <span class="workout-intensity"><i class="fas fa-fire"></i> ${workout.intensity}</span>
          <span class="workout-status">
            <label class="workout-completed-label">
              <input type="checkbox" class="workout-completed-checkbox" data-day="${workout.day}" ${isCompleted ? 'checked' : ''}>
              Completed
            </label>
          </span>
        </div>

        <div class="workout-exercises">
          <h4>Exercise Program</h4>
          <div class="exercise-table">
            <div class="exercise-header">
              <div class="exercise-name">Exercise</div>
              <div class="exercise-sets">Sets</div>
              <div class="exercise-reps">Reps/Time</div>
              <div class="exercise-rest">Rest</div>
            </div>
            ${workout.exercises.map(exercise => `
              <div class="exercise-row">
                <div class="exercise-name">${exercise.name}</div>
                <div class="exercise-sets">${exercise.sets || '-'}</div>
                <div class="exercise-reps">${exercise.reps || exercise.time || '-'}</div>
                <div class="exercise-rest">${exercise.rest || '-'}</div>
              </div>
              ${exercise.notes ? `<div class="exercise-notes"><i class="fas fa-info-circle"></i> ${exercise.notes}</div>` : ''}
            `).join('')}
          </div>
        </div>

        <div class="workout-focus">
          <span class="focus-label">Focus Areas:</span>
          <div class="focus-tags">
            ${workout.focusAreas.map(area => `<span class="focus-tag">${area}</span>`).join('')}
          </div>
        </div>

        <div class="workout-card-actions">
          <button class="workout-details-btn" data-day="${workout.day}">
            <i class="fas fa-clipboard-list"></i> Add Notes & Details
          </button>
        </div>
      </div>
    `;
  });

  planHTML += '</div>';
  workoutPlanDisplay.innerHTML = planHTML;

  // Add event listeners for checkboxes
  const checkboxes = workoutPlanDisplay.querySelectorAll('.workout-completed-checkbox');
  checkboxes.forEach(checkbox => {
    checkbox.addEventListener('change', function() {
      const day = this.dataset.day;
      const card = this.closest('.workout-card');

      if (this.checked) {
        card.classList.add('workout-completed');
        window.workoutHistory[day] = window.workoutHistory[day] || {};
        window.workoutHistory[day].completed = true;
        window.workoutHistory[day].date = new Date().toLocaleDateString();
      } else {
        card.classList.remove('workout-completed');
        if (window.workoutHistory[day]) {
          window.workoutHistory[day].completed = false;
        }
      }

      localStorage.setItem('workoutHistory', JSON.stringify(window.workoutHistory));
    });
  });

  // Add event listeners for details buttons
  const detailButtons = workoutPlanDisplay.querySelectorAll('.workout-details-btn');
  detailButtons.forEach(button => {
    button.addEventListener('click', function() {
      const day = this.dataset.day;
      const modal = document.getElementById('workoutDetailsModal');
      if (modal) {
        const titleEl = document.getElementById('detailsWorkoutTitle');
        if (titleEl) titleEl.textContent = `${day} Workout Details`;
        modal.style.display = 'block';
      }
    });
  });
}

// Make sure the function is available globally
if (typeof window !== 'undefined') {
  window.generateActivityPlan = generateActivityPlan;
}

console.log("✅ Activity plan generator loaded successfully");
