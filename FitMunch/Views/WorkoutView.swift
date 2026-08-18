import SwiftUI
import SwiftData

/// Workout tab — full parity with the web fitness half:
/// `generateActivityPlan.js` (weekly plan) + `exercise_tracker.js` (log sets/reps) + steps goal.
struct WorkoutView: View {
    @Environment(\.modelContext) private var modelContext
    @Query(sort: \WorkoutLog.date, order: .reverse) private var logs: [WorkoutLog]

    // Steps goal — parity with fitness_connector.js steps goal (web uses a local/mock tracker).
    @AppStorage("stepsGoal") private var stepsGoal = 10000
    @AppStorage("stepsToday") private var stepsToday = 0
    @AppStorage("completedWorkoutDays") private var completedWorkoutDays = ""

    @State private var planType = "gym"
    @State private var planLevel = "Beginner"
    @State private var plan: [WorkoutDay] = []
    @State private var hasGeneratedPlan = false

    // Exercise log form
    @State private var exerciseName = ""
    @State private var exerciseSets = 3
    @State private var exerciseReps = ""
    @State private var exerciseWeight = ""

    private let brandGreen = Color(red: 0.086, green: 0.639, blue: 0.290)
    private let types = [("gym", "🏋️ Gym"), ("home", "🏠 Home")]
    private let levels = ["Beginner", "Intermediate", "Advanced"]

    private var completedDays: Set<String> {
        Set(completedWorkoutDays.components(separatedBy: ",").filter { !$0.isEmpty })
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    stepsCard
                    planCard
                    exerciseLogCard
                }
                .padding()
            }
            .navigationTitle("Workout")
            .onAppear {
                if !hasGeneratedPlan { generate() }
            }
        }
    }

    // MARK: - Steps

    private var stepsCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Daily steps")
                .font(.headline)
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text("\(stepsToday)")
                        .font(.system(size: 34, weight: .bold, design: .rounded))
                    Text("of \(stepsGoal) goal")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Button {
                    stepsToday += 1000
                } label: {
                    Label("+1,000", systemImage: "plus.circle.fill")
                        .font(.subheadline.weight(.semibold))
                }
                .buttonStyle(.bordered)
                .tint(brandGreen)
            }
            ProgressView(value: Double(min(stepsToday, stepsGoal)), total: Double(stepsGoal))
                .tint(brandGreen)
        }
        .padding()
        .background(Color(.secondarySystemBackground))
        .clipShape(RoundedRectangle(cornerRadius: 16))
    }

    // MARK: - Plan

    private var planCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Weekly plan")
                .font(.headline)

            Picker("Type", selection: $planType) {
                ForEach(types, id: \.0) { t in Text(t.1).tag(t.0) }
            }
            .pickerStyle(.segmented)

            Picker("Level", selection: $planLevel) {
                ForEach(levels, id: \.self) { l in Text(l).tag(l) }
            }
            .pickerStyle(.segmented)

            Button {
                generate()
            } label: {
                Text("Generate plan").frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .tint(brandGreen)

            ForEach(plan) { day in
                workoutDayCard(day)
            }
        }
    }

    private func workoutDayCard(_ day: WorkoutDay) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(day.day)
                        .font(.subheadline.weight(.semibold))
                    Text(day.workout)
                        .font(.title3.bold())
                    Text("\(day.intensity) · ~\(day.duration) min")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Button {
                    toggleDay(day)
                } label: {
                    Image(systemName: completedDays.contains(day.day) ? "checkmark.circle.fill" : "circle")
                        .font(.title2)
                        .foregroundStyle(completedDays.contains(day.day) ? brandGreen : .secondary)
                }
            }

            ForEach(day.exercises) { ex in
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(ex.name).font(.subheadline.weight(.medium))
                        if let notes = ex.notes, !notes.isEmpty {
                            Text(notes).font(.caption).foregroundStyle(.secondary)
                        }
                    }
                    Spacer()
                    VStack(alignment: .trailing, spacing: 2) {
                        Text("\(ex.sets) sets").font(.caption).foregroundStyle(.secondary)
                        Text(ex.reps ?? ex.time ?? "—").font(.caption).foregroundStyle(.secondary)
                    }
                }
                .padding(.vertical, 4)
            }

            if !day.focusAreas.isEmpty {
                Text(day.focusAreas.joined(separator: " · "))
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
        }
        .padding()
        .background(Color(.tertiarySystemBackground))
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }

    private func toggleDay(_ day: WorkoutDay) {
        var days = completedDays
        if days.contains(day.day) {
            days.remove(day.day)
        } else {
            days.insert(day.day)
        }
        completedWorkoutDays = days.sorted().joined(separator: ",")
    }

    private func generate() {
        plan = WorkoutPlanGenerator.plan(type: planType, level: planLevel)
        hasGeneratedPlan = true
    }

    // MARK: - Exercise log

    private var exerciseLogCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Log an exercise")
                .font(.headline)

            TextField("Exercise name", text: $exerciseName)
                .textFieldStyle(.roundedBorder)

            HStack {
                Stepper("Sets: \(exerciseSets)", value: $exerciseSets, in: 1...20)
                    .font(.subheadline)
            }
            HStack(spacing: 12) {
                TextField("Reps (e.g. 10-12)", text: $exerciseReps)
                    .textFieldStyle(.roundedBorder)
                    .keyboardType(.numbersAndPunctuation)
                TextField("Weight kg", text: $exerciseWeight)
                    .textFieldStyle(.roundedBorder)
                    .keyboardType(.decimalPad)
            }

            Button {
                logExercise()
            } label: {
                Text("Log exercise").frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .tint(brandGreen)
            .disabled(exerciseName.trimmingCharacters(in: .whitespaces).isEmpty)

            if !logs.isEmpty {
                Text("Recent logs")
                    .font(.subheadline.weight(.semibold))
                    .padding(.top, 4)
                ForEach(logs.prefix(10)) { log in
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(log.name).font(.subheadline.weight(.medium))
                            Text(log.date.formatted(date: .abbreviated, time: .shortened))
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                        Spacer()
                        Text("\(log.sets) × \(log.reps)")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        if log.weight > 0 {
                            Text("\(log.weight, specifier: "%.1f")kg")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                    .padding(.vertical, 2)
                }
            }
        }
        .padding()
        .background(Color(.secondarySystemBackground))
        .clipShape(RoundedRectangle(cornerRadius: 16))
    }

    private func logExercise() {
        let name = exerciseName.trimmingCharacters(in: .whitespaces)
        guard !name.isEmpty else { return }
        let weight = Double(exerciseWeight) ?? 0
        let log = WorkoutLog(name: name, sets: exerciseSets, reps: exerciseReps, weight: weight)
        modelContext.insert(log)
        try? modelContext.save()
        exerciseName = ""
        exerciseReps = ""
        exerciseWeight = ""
    }
}
