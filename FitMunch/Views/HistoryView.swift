import SwiftUI
import SwiftData
import Charts

/// Progress screen. Opened from Me, and usable on its own in previews.
struct HistoryView: View {
    var embedded: Bool = false

    @Environment(\.modelContext) private var modelContext
    @StateObject private var viewModel: HistoryViewModel
    @State private var showDatePicker = false
    @State private var showExportSheet = false
    @State private var showLogMeal = false
    @State private var exportData: String?
    
    init(modelContext: ModelContext, embedded: Bool = false) {
        self.embedded = embedded
        _viewModel = StateObject(wrappedValue: HistoryViewModel(modelContext: modelContext))
    }
    
    var body: some View {
        Group {
            if embedded {
                historyContent
            } else {
                NavigationStack {
                    historyContent
                }
            }
        }
    }

    private var historyContent: some View {
        ScrollView {
                VStack(spacing: 24) {
                    // Date range selector
                    dateRangeSelector
                    
                    // Statistics summary
                    statisticsSummary
                    
                    // Chart visualization
                    if !viewModel.chartData.isEmpty {
                        chartSection
                    }
                    
                    // Meal history
                    mealHistorySection
                }
                .padding()
            }
            .navigationTitle("Progress")
            .scrollClearsTabBar()
            .background(Theme.surface)
            .sheet(isPresented: $showLogMeal) {
                DetailView(modelContext: modelContext)
            }
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Menu {
                        if viewModel.hasPremiumAccess {
                            Button {
                                Task {
                                    exportData = await viewModel.exportData()
                                    showExportSheet = true
                                }
                            } label: {
                                Label("Export Data", systemImage: "square.and.arrow.up")
                            }
                        }
                        
                        Button {
                            showDatePicker = true
                        } label: {
                            Label("Custom Range", systemImage: "calendar")
                        }
                    } label: {
                        Image(systemName: "ellipsis.circle")
                    }
                }
            }
            .overlay {
                if viewModel.isLoading {
                    ProgressView()
                        .scaleEffect(1.5)
                        .padding()
                        .background(.regularMaterial)
                        .cornerRadius(16)
                }
            }
            .alert("Error", isPresented: .constant(viewModel.errorMessage != nil)) {
                Button("OK") {
                    viewModel.errorMessage = nil
                }
            } message: {
                if let error = viewModel.errorMessage {
                    Text(error)
                }
            }
            .sheet(isPresented: $showDatePicker) {
                DateRangePicker(
                    startDate: $viewModel.startDate,
                    endDate: $viewModel.endDate,
                    isPresented: $showDatePicker,
                    onApply: {
                        viewModel.selectedDateRange = .custom
                        viewModel.updateDateRange()
                    }
                )
            }
            .sheet(isPresented: $showExportSheet) {
                if let data = exportData {
                    ExportSheet(data: data)
                }
            }
            .refreshable {
                viewModel.loadMealsForDateRange()
                viewModel.generateChartData()
            }
    }
    
    /// Date range selector
    private var dateRangeSelector: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Date Range")
                .font(.headline)
            
            Picker("Date Range", selection: $viewModel.selectedDateRange) {
                ForEach(DateRange.allCases, id: \.self) { range in
                    Text(range.rawValue)
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                        .tag(range)
                }
            }
            .pickerStyle(.segmented)
            .accessibilityIdentifier("progress-range")
            .onChange(of: viewModel.selectedDateRange) { _, range in
                if range == .custom {
                    showDatePicker = true
                }
                viewModel.updateDateRange()
            }
            .sensoryFeedback(.selection, trigger: viewModel.selectedDateRange)
            
            Text(viewModel.formattedDateRange)
                .font(.caption)
                .foregroundColor(.secondary)
        }
        .padding()
        .background(Color.gray.opacity(0.1))
        .cornerRadius(12)
    }
    
    /// Statistics summary
    private var statisticsSummary: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Statistics")
                .font(.title2)
                .fontWeight(.semibold)
            
            HStack {
                StatCard(
                    title: "Total Meals",
                    value: "\(viewModel.meals.count)",
                    icon: "fork.knife",
                    color: Theme.brandGreen
                )
                
                StatCard(
                    title: "Avg. Calories",
                    value: String(format: "%.0f", viewModel.averages.calories),
                    icon: "flame",
                    color: .red
                )
                
                StatCard(
                    title: "Avg. Protein",
                    value: String(format: "%.0fg", viewModel.averages.protein),
                    icon: "dumbbell",
                    color: .green
                )
            }
        }
    }
    
    /// Chart section
    private var chartSection: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                Text("Calorie Trends")
                    .font(.title2)
                    .fontWeight(.semibold)
                
                Spacer()
                
                if !viewModel.hasPremiumAccess {
                    PremiumBadge()
                }
            }
            
            Chart(viewModel.chartData) { dataPoint in
                LineMark(
                    x: .value("Date", dataPoint.date),
                    y: .value("Calories", dataPoint.calories)
                )
                .foregroundStyle(.red)
                .lineStyle(StrokeStyle(lineWidth: 3))
                
                PointMark(
                    x: .value("Date", dataPoint.date),
                    y: .value("Calories", dataPoint.calories)
                )
                .foregroundStyle(.red)
                .symbolSize(50)
            }
            .frame(height: 200)
            .chartXAxis {
                AxisMarks(values: .stride(by: .day)) { value in
                    if let date = value.as(Date.self) {
                        AxisValueLabel {
                            Text(date, format: .dateTime.day().month())
                                .font(.caption)
                        }
                    }
                }
            }
            .chartYAxis {
                AxisMarks { value in
                    AxisValueLabel {
                        if let calories = value.as(Int.self) {
                            Text("\(calories)")
                                .font(.caption)
                        }
                    }
                }
            }
            .padding()
            .background(Color.gray.opacity(0.1))
            .cornerRadius(12)
        }
    }
    
    /// Meal history section
    private var mealHistorySection: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                Text("Meal History")
                    .font(.title2)
                    .fontWeight(.semibold)
                
                Spacer()
                
                if !viewModel.hasPremiumAccess && viewModel.selectedDateRange != .week {
                    PremiumBadge()
                }
            }
            
            if viewModel.meals.isEmpty {
                emptyState
            } else {
                ForEach(viewModel.meals) { meal in
                    HistoryMealCard(meal: meal)
                }
            }
        }
    }
    
    /// Empty state when no meals in history
    private var emptyState: some View {
        ContentUnavailableView {
            Label("No meals in this range", systemImage: "chart.line.uptrend.xyaxis")
        } description: {
            if !viewModel.hasPremiumAccess && viewModel.selectedDateRange != .week {
                Text("Free tier limited to 7-day history. Upgrade for full access.")
            } else {
                Text("Your progress shows up after you log a meal.")
            }
        } actions: {
            Button("Log your first meal") {
                showLogMeal = true
            }
            .buttonStyle(PrimaryButtonStyle())
            .accessibilityIdentifier("history-log-first-meal")
        }
    }
}

/// Stat card for statistics summary
private struct StatCard: View {
    let title: String
    let value: String
    let icon: String
    let color: Color
    
    var body: some View {
        VStack(spacing: 8) {
            Image(systemName: icon)
                .font(.title2)
                .foregroundColor(color)
            
            Text(value)
                .font(.system(.title2, design: .rounded).monospacedDigit().weight(.bold))
            
            Text(title)
                .font(.caption)
                .foregroundColor(.secondary)
        }
        .frame(maxWidth: .infinity)
        .padding()
        .background(color.opacity(0.1))
        .cornerRadius(Theme.Radius.medium)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(title) \(value)")
    }
}

/// History meal card
private struct HistoryMealCard: View {
    let meal: Meal
    
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text(meal.name)
                        .font(.headline)
                    Text(Constants.dateFormatter.string(from: meal.date))
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
                
                Spacer()
                
                Text(Constants.timeFormatter.string(from: meal.date))
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
            
            HStack {
                NutritionBadge(value: meal.totalCalories, unit: "cal", color: .red)
                NutritionBadge(value: meal.totalProtein, unit: "P", color: Theme.brandGreen)
                NutritionBadge(value: meal.totalCarbs, unit: "C", color: .orange)
                NutritionBadge(value: meal.totalFats, unit: "F", color: .green)
                
                Spacer()
                
                Text("\(meal.foodItems.count) items")
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
        }
        .padding()
        .background(Color.gray.opacity(0.1))
        .cornerRadius(12)
    }
}

/// Nutrition badge for history cards
private struct NutritionBadge: View {
    let value: Int
    let unit: String
    let color: Color
    
    var body: some View {
        HStack(spacing: 2) {
            Text("\(value)")
                .font(.caption)
                .fontWeight(.semibold)
            Text(unit)
                .font(.caption2)
                .foregroundColor(.secondary)
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background(color.opacity(0.1))
        .foregroundColor(color)
        .cornerRadius(4)
    }
}

/// Premium badge for locked features
private struct PremiumBadge: View {
    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: "crown.fill")
                .font(.caption)
                .foregroundColor(.yellow)
            Text("Premium")
                .font(.caption)
                .fontWeight(.semibold)
                .foregroundColor(.yellow)
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background(Color.yellow.opacity(0.1))
        .cornerRadius(4)
    }
}

/// Date range picker sheet
private struct DateRangePicker: View {
    @Binding var startDate: Date
    @Binding var endDate: Date
    @Binding var isPresented: Bool
    let onApply: () -> Void
    
    var body: some View {
        NavigationStack {
            Form {
                Section("Start Date") {
                    DatePicker("From", selection: $startDate, displayedComponents: .date)
                }
                
                Section("End Date") {
                    DatePicker("To", selection: $endDate, displayedComponents: .date)
                }
                
                Section {
                    Button("Apply Range") {
                        onApply()
                        isPresented = false
                    }
                    .frame(maxWidth: .infinity)
                    .foregroundColor(.white)
                    .padding()
                    .background(Theme.buttonFill)
                    .cornerRadius(8)
                }
                .listRowBackground(Color.clear)
            }
            .navigationTitle("Custom Date Range")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("Cancel") {
                        isPresented = false
                    }
                }
            }
        }
        .presentationDetents([.medium])
    }
}

/// Export sheet for data export
private struct ExportSheet: View {
    let data: String
    @Environment(\.dismiss) private var dismiss
    @State private var shareSheet = false
    
    var body: some View {
        NavigationStack {
            VStack(spacing: 20) {
                Image(systemName: "square.and.arrow.up")
                    .font(.system(size: 60))
                    .foregroundStyle(Theme.brandGreen)
                
                Text("Export Complete")
                    .font(.title2)
                    .fontWeight(.semibold)
                
                Text("Your data has been prepared for export. You can share it as a CSV file.")
                    .font(.body)
                    .foregroundColor(.secondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal)
                
                VStack(alignment: .leading, spacing: 8) {
                    Text("Preview:")
                        .font(.headline)
                    
                    ScrollView {
                        Text(data)
                            .font(.system(.caption, design: .monospaced))
                            .padding()
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(Color.gray.opacity(0.1))
                            .cornerRadius(8)
                    }
                    .frame(height: 200)
                }
                .padding()
                
                Spacer()
                
                Button("Share") {
                    shareSheet = true
                }
                .frame(maxWidth: .infinity)
                .padding()
                .background(Theme.buttonFill)
                .foregroundColor(.white)
                .cornerRadius(12)
                .padding(.horizontal)
            }
            .padding()
            .navigationTitle("Export Data")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Done") {
                        dismiss()
                    }
                }
            }
            .sheet(isPresented: $shareSheet) {
                ShareSheet(activityItems: [data])
            }
        }
    }
}

/// Share sheet for exporting data
private struct ShareSheet: UIViewControllerRepresentable {
    let activityItems: [Any]
    
    func makeUIViewController(context: Context) -> UIActivityViewController {
        let controller = UIActivityViewController(activityItems: activityItems, applicationActivities: nil)
        return controller
    }
    
    func updateUIViewController(_ uiViewController: UIActivityViewController, context: Context) {}
}

#Preview {
    HistoryView(modelContext: try! ModelContainer(for: Meal.self, UserProfile.self, FoodItem.self).mainContext)
}