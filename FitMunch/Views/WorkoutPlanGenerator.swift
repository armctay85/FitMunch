import Foundation

/// Parity mirror of the web `generateActivityPlan.js` plan data.
/// Types: gym (Beginner/Intermediate/Advanced) + home (bodyweight).
struct WorkoutExercise: Identifiable {
    let id = UUID()
    let name: String
    let sets: Int
    let reps: String?
    let time: String?
    let rest: String
    let notes: String?

    init(name: String, sets: Int, reps: String? = nil, time: String? = nil, rest: String = "60s", notes: String? = nil) {
        self.name = name
        self.sets = sets
        self.reps = reps
        self.time = time
        self.rest = rest
        self.notes = notes
    }
}

struct WorkoutDay: Identifiable {
    let id = UUID()
    let day: String
    let workout: String
    let exercises: [WorkoutExercise]
    let duration: Int
    let intensity: String
    let focusAreas: [String]
}

enum WorkoutPlanGenerator {
    static func plan(type: String, level: String) -> [WorkoutDay] {
        if type == "home" { return homePlan(level: level) }
        switch level {
        case "Beginner": return gymBeginner
        case "Advanced": return gymAdvanced
        default: return gymIntermediate
        }
    }

    private static let gymBeginner: [WorkoutDay] = [
        WorkoutDay(day: "Monday", workout: "Full Body Foundation", exercises: [
            WorkoutExercise(name: "Bodyweight Squats", sets: 3, reps: "10-12", notes: "Focus on form"),
            WorkoutExercise(name: "Push-ups (modified if needed)", sets: 3, reps: "5-10", notes: "Start with wall/incline if needed"),
            WorkoutExercise(name: "Dumbbell Rows", sets: 3, reps: "8-10", notes: "Light weight, focus on back squeeze"),
            WorkoutExercise(name: "Plank", sets: 3, time: "20-30s", rest: "45s", notes: "Keep body straight"),
            WorkoutExercise(name: "Glute Bridges", sets: 3, reps: "12-15", rest: "45s", notes: "Squeeze glutes at top"),
        ], duration: 1, intensity: "Light to Moderate", focusAreas: ["Full Body", "Foundation Building", "Form Learning"]),
        WorkoutDay(day: "Wednesday", workout: "Cardio & Core", exercises: [
            WorkoutExercise(name: "Treadmill Walk/Jog", sets: 1, time: "15-20 min", rest: "N/A", notes: "Start slow, build endurance"),
            WorkoutExercise(name: "Bicycle Crunches", sets: 3, reps: "10 each side", rest: "45s", notes: "Slow and controlled"),
            WorkoutExercise(name: "Mountain Climbers", sets: 3, time: "20s", rest: "40s", notes: "Keep hips stable"),
            WorkoutExercise(name: "Russian Twists", sets: 3, reps: "15", rest: "45s", notes: "Use bodyweight first"),
            WorkoutExercise(name: "Walking", sets: 1, time: "10 min", rest: "N/A", notes: "Cool down pace"),
        ], duration: 1, intensity: "Moderate", focusAreas: ["Cardiovascular Health", "Core Strength", "Endurance"]),
        WorkoutDay(day: "Friday", workout: "Strength & Flexibility", exercises: [
            WorkoutExercise(name: "Goblet Squats", sets: 3, reps: "8-12", notes: "Light dumbbell"),
            WorkoutExercise(name: "Incline Push-ups", sets: 3, reps: "8-12", notes: "Use bench or step"),
            WorkoutExercise(name: "Lat Pulldowns", sets: 3, reps: "10-12", notes: "Light weight, focus on form"),
            WorkoutExercise(name: "Side Plank", sets: 3, time: "15s each side", rest: "30s", notes: "Modify on knees if needed"),
            WorkoutExercise(name: "Stretching Routine", sets: 1, time: "10 min", rest: "N/A", notes: "Full body stretch"),
        ], duration: 1, intensity: "Moderate", focusAreas: ["Strength Building", "Flexibility", "Balance"]),
    ]

    private static let gymIntermediate: [WorkoutDay] = [
        WorkoutDay(day: "Monday", workout: "Upper Body Push", exercises: [
            WorkoutExercise(name: "Bench Press", sets: 4, reps: "8-10", rest: "90s", notes: "Progressive overload"),
            WorkoutExercise(name: "Shoulder Press", sets: 4, reps: "8-10", rest: "90s", notes: "Control the weight"),
            WorkoutExercise(name: "Incline Dumbbell Press", sets: 3, reps: "10-12", rest: "75s", notes: "45-degree angle"),
            WorkoutExercise(name: "Lateral Raises", sets: 3, reps: "12-15", notes: "Light weight, focus on form"),
            WorkoutExercise(name: "Tricep Dips", sets: 3, reps: "10-15", notes: "Use bench or chair"),
            WorkoutExercise(name: "Diamond Push-ups", sets: 3, reps: "8-12", notes: "Target triceps"),
        ], duration: 1, intensity: "Moderate to High", focusAreas: ["Chest", "Shoulders", "Triceps", "Upper Body Power"]),
        WorkoutDay(day: "Tuesday", workout: "Lower Body", exercises: [
            WorkoutExercise(name: "Squats", sets: 4, reps: "10-12", rest: "120s", notes: "Full depth, control ascent"),
            WorkoutExercise(name: "Romanian Deadlifts", sets: 4, reps: "8-10", rest: "120s", notes: "Hip hinge movement"),
            WorkoutExercise(name: "Walking Lunges", sets: 3, reps: "12 each leg", rest: "90s", notes: "Step into lunge"),
            WorkoutExercise(name: "Leg Press", sets: 3, reps: "12-15", rest: "90s", notes: "Control the negative"),
            WorkoutExercise(name: "Calf Raises", sets: 4, reps: "15-20", notes: "Full range of motion"),
            WorkoutExercise(name: "Leg Curls", sets: 3, reps: "12-15", notes: "Squeeze hamstrings"),
        ], duration: 1, intensity: "High", focusAreas: ["Quadriceps", "Hamstrings", "Glutes", "Lower Body Power"]),
        WorkoutDay(day: "Thursday", workout: "Upper Body Pull", exercises: [
            WorkoutExercise(name: "Pull-ups/Lat Pulldowns", sets: 4, reps: "6-10", rest: "90s", notes: "Full range of motion"),
            WorkoutExercise(name: "Barbell Rows", sets: 4, reps: "8-10", rest: "90s", notes: "Squeeze shoulder blades"),
            WorkoutExercise(name: "Face Pulls", sets: 3, reps: "15", notes: "External rotation focus"),
            WorkoutExercise(name: "Hammer Curls", sets: 3, reps: "10-12", notes: "Control the weight"),
            WorkoutExercise(name: "Barbell Curls", sets: 3, reps: "8-10", notes: "No swinging"),
            WorkoutExercise(name: "Reverse Flyes", sets: 3, reps: "12-15", notes: "Target rear delts"),
        ], duration: 1, intensity: "Moderate to High", focusAreas: ["Back", "Biceps", "Rear Delts", "Posture"]),
        WorkoutDay(day: "Saturday", workout: "Core & Conditioning", exercises: [
            WorkoutExercise(name: "HIIT Circuit", sets: 5, time: "30s", rest: "30s", notes: "Burpees, mountain climbers, jumping jacks"),
            WorkoutExercise(name: "Plank Variations", sets: 4, time: "30-45s", rest: "30s", notes: "Front, side, with leg lifts"),
            WorkoutExercise(name: "Russian Twists", sets: 3, reps: "20", rest: "45s", notes: "Add weight if possible"),
            WorkoutExercise(name: "Dead Bug", sets: 3, reps: "10 each side", rest: "45s", notes: "Keep core engaged"),
            WorkoutExercise(name: "Hanging Leg Raises", sets: 3, reps: "8-12", notes: "Control the swing"),
            WorkoutExercise(name: "Foam Rolling", sets: 1, time: "10 min", rest: "N/A", notes: "Full body recovery"),
        ], duration: 1, intensity: "High", focusAreas: ["Core Strength", "Conditioning", "Recovery", "Flexibility"]),
    ]

    private static let gymAdvanced: [WorkoutDay] = [
        WorkoutDay(day: "Monday", workout: "Heavy Push", exercises: [
            WorkoutExercise(name: "Barbell Bench Press", sets: 5, reps: "5-8", rest: "120s", notes: "Work to a heavy top set"),
            WorkoutExercise(name: "Overhead Press", sets: 4, reps: "6-8", rest: "120s", notes: "Strict form"),
            WorkoutExercise(name: "Weighted Dips", sets: 4, reps: "8-10", rest: "90s", notes: "Add weight if possible"),
            WorkoutExercise(name: "Close-grip Bench", sets: 3, reps: "8-10", rest: "90s", notes: "Tricep focus"),
            WorkoutExercise(name: "Cable Flyes", sets: 3, reps: "12-15", notes: "Slow eccentric"),
        ], duration: 1, intensity: "Very High", focusAreas: ["Strength", "Power", "Chest", "Shoulders", "Triceps"]),
        WorkoutDay(day: "Tuesday", workout: "Heavy Pull", exercises: [
            WorkoutExercise(name: "Deadlifts", sets: 5, reps: "3-6", rest: "180s", notes: "Reset each rep"),
            WorkoutExercise(name: "Weighted Pull-ups", sets: 4, reps: "6-8", rest: "120s", notes: "Add weight"),
            WorkoutExercise(name: "Pendlay Rows", sets: 4, reps: "6-8", rest: "120s", notes: "Explosive pull"),
            WorkoutExercise(name: "Barbell Curls", sets: 3, reps: "8-10", rest: "90s", notes: "Strict, no swing"),
        ], duration: 1, intensity: "Very High", focusAreas: ["Strength", "Power", "Back", "Biceps", "Posterior Chain"]),
        WorkoutDay(day: "Wednesday", workout: "Active Recovery", exercises: [
            WorkoutExercise(name: "Light Cardio", sets: 1, time: "20 min", rest: "N/A", notes: "Zone 2"),
            WorkoutExercise(name: "Mobility Flow", sets: 1, time: "15 min", rest: "N/A", notes: "Hips, shoulders, spine"),
            WorkoutExercise(name: "Foam Rolling", sets: 1, time: "10 min", rest: "N/A", notes: "Full body"),
        ], duration: 1, intensity: "Light", focusAreas: ["Recovery", "Mobility", "Blood Flow", "Injury Prevention"]),
        WorkoutDay(day: "Thursday", workout: "Heavy Legs", exercises: [
            WorkoutExercise(name: "Back Squats", sets: 5, reps: "4-6", rest: "180s", notes: "Heavy top set"),
            WorkoutExercise(name: "Romanian Deadlifts", sets: 4, reps: "6-8", rest: "120s", notes: "Hamstring focus"),
            WorkoutExercise(name: "Walking Lunges", sets: 3, reps: "10 each leg", rest: "90s", notes: "Weighted"),
            WorkoutExercise(name: "Leg Press", sets: 4, reps: "8-12", rest: "90s", notes: "Deep range"),
        ], duration: 1, intensity: "Very High", focusAreas: ["Strength", "Power", "Quadriceps", "Hamstrings", "Glutes"]),
        WorkoutDay(day: "Friday", workout: "Hypertrophy Volume", exercises: [
            WorkoutExercise(name: "DB Incline Press", sets: 4, reps: "10-12", rest: "75s", notes: "Squeeze"),
            WorkoutExercise(name: "Machine Rows", sets: 4, reps: "10-12", rest: "75s", notes: "Controlled"),
            WorkoutExercise(name: "Lateral Raises", sets: 4, reps: "15-20", notes: "Burnout"),
            WorkoutExercise(name: "Hammer Curls", sets: 3, reps: "12-15", notes: "Pump work"),
            WorkoutExercise(name: "Tricep Pushdowns", sets: 3, reps: "12-15", notes: "Constant tension"),
        ], duration: 1, intensity: "High", focusAreas: ["Hypertrophy", "Muscle Endurance", "Definition", "Volume"]),
        WorkoutDay(day: "Saturday", workout: "Conditioning", exercises: [
            WorkoutExercise(name: "Sprints", sets: 8, time: "20s", rest: "60s", notes: "Max effort"),
            WorkoutExercise(name: "Sled Pushes", sets: 5, time: "20m", rest: "90s", notes: "Heavy"),
            WorkoutExercise(name: "Box Jumps", sets: 4, reps: "5", rest: "60s", notes: "Explosive"),
        ], duration: 1, intensity: "Very High", focusAreas: ["Power", "Conditioning", "Explosiveness", "Work Capacity"]),
    ]

    private static func homePlan(level: String) -> [WorkoutDay] {
        [
            WorkoutDay(day: "Monday", workout: "Full Body Bodyweight", exercises: [
                WorkoutExercise(name: "Squats", sets: 3, reps: "15", notes: "Tempo control"),
                WorkoutExercise(name: "Push-ups", sets: 3, reps: "10-15", notes: "Full range"),
                WorkoutExercise(name: "Glute Bridges", sets: 3, reps: "15", notes: "Squeeze top"),
                WorkoutExercise(name: "Plank", sets: 3, time: "30s", rest: "30s", notes: "Straight line"),
            ], duration: 1, intensity: "Moderate", focusAreas: ["Full Body", "Strength", "Endurance"]),
            WorkoutDay(day: "Wednesday", workout: "Cardio & Core", exercises: [
                WorkoutExercise(name: "Jumping Jacks", sets: 3, time: "45s", rest: "30s", notes: "Keep pace"),
                WorkoutExercise(name: "High Knees", sets: 3, time: "30s", rest: "30s", notes: "Fast"),
                WorkoutExercise(name: "Mountain Climbers", sets: 3, time: "30s", rest: "30s", notes: "Stable hips"),
                WorkoutExercise(name: "Bicycle Crunches", sets: 3, reps: "15 each side", notes: "Controlled"),
            ], duration: 1, intensity: "Moderate", focusAreas: ["Cardiovascular", "Endurance"]),
            WorkoutDay(day: "Friday", workout: "Strength & Stability", exercises: [
                WorkoutExercise(name: "Lunges", sets: 3, reps: "12 each leg", notes: "Balance"),
                WorkoutExercise(name: "Pike Push-ups", sets: 3, reps: "8-10", notes: "Shoulder focus"),
                WorkoutExercise(name: "Single-leg Glute Bridge", sets: 3, reps: "12 each", notes: "Hip stability"),
                WorkoutExercise(name: "Side Plank", sets: 3, time: "20s each", rest: "30s", notes: "Hips up"),
            ], duration: 1, intensity: "Moderate", focusAreas: ["Strength", "Stability"]),
        ]
    }
}
