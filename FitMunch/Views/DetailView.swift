import SwiftUI
import SwiftData

/// Meal detail and logging screen
struct DetailView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.modelContext) private var modelContext
    @StateObject private var viewModel: DetailViewModel
    @State private var quantity: String = "1.0"
    @State private var selectedFoodItem: FoodItem?
    @State private var showQuantitySheet = false
    
    init(modelContext: ModelContext, meal: Meal? = nil) {
        if let meal = meal {
            _viewModel = StateObject(wrappedValue: DetailViewModel(modelContext: modelContext, meal: meal))
        } else {
            _viewModel = StateObject(wrappedValue: DetailViewModel(modelContext: modelContext))
        }
    }
    
    var body: some View {
        NavigationStack {
            Form {
                // Meal name section
                Section("Meal Details") {
                    TextField("Meal name (e.g., Breakfast, Lunch)", text: $viewModel.mealName)
                        .textFieldStyle(.roundedBorder)
                }
                
                // Food search section
                Section("Add Food") {
                    HStack {
                        Image(systemName: "magnifyingglass")
                            .foregroundColor(.secondary)
                        TextField("Search for food...", text: $viewModel.searchQuery)
                            .onSubmit {
                                viewModel.searchFoods()
                            }
                    }
                    
                    if !viewModel.searchResults.isEmpty {
                        ForEach(viewModel.searchResults) { foodItem in
                            Button {
                                selectedFoodItem = foodItem
                                showQuantitySheet = true
                            } label: {
                                FoodItemRow(foodItem: foodItem)
                            }
                            .buttonStyle(.plain)
                        }
                    } else if !viewModel.searchQuery.isEmpty {
                        Text("No results found")
                            .foregroundColor(.secondary)
                            .font(.caption)
                            .frame(maxWidth: .infinity, alignment: .center)
                            .padding()
                    }
                }
                
                // Added foods section
                if !viewModel.foodItems.isEmpty {
                    Section("Added Foods") {
                        ForEach(Array(viewModel.foodItems.enumerated()), id: \.element.id) { index, foodItem in
                            HStack {
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(foodItem.name)
                                        .font(.headline)
                                    Text("\(foodItem.quantity, specifier: "%.1f") serving(s)")
                                        .font(.caption)
                                        .foregroundColor(.secondary)
                                }
                                
                                Spacer()
                                
                                HStack(spacing: 12) {
                                    NutritionInfo(foodItem: foodItem)
                                    
                                    Button(role: .destructive) {
                                        viewModel.removeFoodItem(at: index)
                                    } label: {
                                        Image(systemName: "trash")
                                            .font(.caption)
                                            .foregroundColor(.red)
                                    }
                                    .buttonStyle(.borderless)
                                }
                            }
                            .padding(.vertical, 4)
                        }
                    }
                }
                
                // Nutrition summary section
                Section("Nutrition Summary") {
                    VStack(spacing: 16) {
                        HStack {
                            NutritionSummaryItem(
                                title: "Calories",
                                value: viewModel.totalNutrition.calories,
                                unit: "cal",
                                color: .red
                            )
                            
                            NutritionSummaryItem(
                                title: "Protein",
                                value: viewModel.totalNutrition.protein,
                                unit: "g",
                                color: .blue
                            )
                            
                            NutritionSummaryItem(
                                title: "Carbs",
                                value: viewModel.totalNutrition.carbs,
                                unit: "g",
                                color: .orange
                            )
                            
                            NutritionSummaryItem(
                                title: "Fats",
                                value: viewModel.totalNutrition.fats,
                                unit: "g",
                                color: .green
                            )
                        }
                        
                        if viewModel.totalNutrition.calories > 0 {
                            Text("Total for this meal")
                                .font(.caption)
                                .foregroundColor(.secondary)
                        }
                    }
                    .padding(.vertical, 8)
                }
            }
            .navigationTitle(viewModel.isEditing ? "Edit Meal" : "Log Meal")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("Cancel") {
                        dismiss()
                    }
                }
                
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Save") {
                        Task {
                            if await viewModel.saveMeal() {
                                dismiss()
                            }
                        }
                    }
                    .disabled(!viewModel.canSave)
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
            .sheet(isPresented: $showQuantitySheet) {
                if let foodItem = selectedFoodItem {
                    QuantitySheet(
                        foodItem: foodItem,
                        quantity: $quantity,
                        onAdd: { qty in
                            if let quantityValue = Double(qty), quantityValue > 0 {
                                viewModel.addFoodItem(foodItem, quantity: quantityValue)
                                self.quantity = "1.0"
                                selectedFoodItem = nil
                                showQuantitySheet = false
                            }
                        },
                        onCancel: {
                            selectedFoodItem = nil
                            showQuantitySheet = false
                        }
                    )
                }
            }
        }
    }
}

/// Food item row for search results
private struct FoodItemRow: View {
    let foodItem: FoodItem
    
    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 4) {
                Text(foodItem.name)
                    .font(.headline)
                Text("Per \(foodItem.quantity, specifier: "%.0f")g")
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
            
            Spacer()
            
            NutritionInfo(foodItem: foodItem)
        }
        .padding(.vertical, 8)
        .contentShape(Rectangle())
    }
}

/// Nutrition information for food items
private struct NutritionInfo: View {
    let foodItem: FoodItem
    
    var body: some View {
        HStack(spacing: 8) {
            NutritionPill(value: foodItem.calories, unit: "cal", color: .red)
            NutritionPill(value: foodItem.protein, unit: "P", color: .blue)
            NutritionPill(value: foodItem.carbs, unit: "C", color: .orange)
            NutritionPill(value: foodItem.fats, unit: "F", color: .green)
        }
    }
}

/// Nutrition pill for compact display
private struct NutritionPill: View {
    let value: Int
    let unit: String
    let color: Color
    
    var body: some View {
        Text("\(value)\(unit)")
            .font(.caption2)
            .fontWeight(.medium)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(color.opacity(0.1))
            .foregroundColor(color)
            .cornerRadius(4)
    }
}

/// Nutrition summary item for meal totals
private struct NutritionSummaryItem: View {
    let title: String
    let value: Int
    let unit: String
    let color: Color
    
    var body: some View {
        VStack(spacing: 4) {
            Text(title)
                .font(.caption)
                .foregroundColor(.secondary)
            
            Text("\(value)")
                .font(.title3)
                .fontWeight(.bold)
                .foregroundColor(color)
            
            Text(unit)
                .font(.caption2)
                .foregroundColor(.secondary)
        }
        .frame(maxWidth: .infinity)
    }
}

/// Quantity input sheet
private struct QuantitySheet: View {
    let foodItem: FoodItem
    @Binding var quantity: String
    let onAdd: (String) -> Void
    let onCancel: () -> Void
    
    @State private var quantityValue: Double = 1.0
    @FocusState private var isQuantityFocused: Bool
    
    var body: some View {
        NavigationStack {
            Form {
                Section {
                    VStack(alignment: .leading, spacing: 16) {
                        Text(foodItem.name)
                            .font(.headline)
                        
                        HStack {
                            Text("Quantity:")
                                .font(.subheadline)
                            
                            Spacer()
                            
                            TextField("", text: $quantity)
                                .keyboardType(.decimalPad)
                                .textFieldStyle(.roundedBorder)
                                .frame(width: 100)
                                .multilineTextAlignment(.trailing)
                                .focused($isQuantityFocused)
                                .onAppear {
                                    isQuantityFocused = true
                                }
                            
                            Text("serving(s)")
                                .font(.subheadline)
                                .foregroundColor(.secondary)
                        }
                        
                        if let quantityNum = Double(quantity), quantityNum > 0 {
                            let nutrition = foodItem.nutritionalValues(for: quantityNum)
                            
                            VStack(alignment: .leading, spacing: 8) {
                                Text("Nutrition for \(quantityNum, specifier: "%.1f") serving(s):")
                                    .font(.subheadline)
                                    .foregroundColor(.secondary)
                                
                                HStack {
                                    NutritionSummaryItem(
                                        title: "Calories",
                                        value: nutrition.calories,
                                        unit: "cal",
                                        color: .red
                                    )
                                    
                                    NutritionSummaryItem(
                                        title: "Protein",
                                        value: nutrition.protein,
                                        unit: "g",
                                        color: .blue
                                    )
                                    
                                    NutritionSummaryItem(
                                        title: "Carbs",
                                        value: nutrition.carbs,
                                        unit: "g",
                                        color: .orange
                                    )
                                    
                                    NutritionSummaryItem(
                                        title: "Fats",
                                        value: nutrition.fats,
                                        unit: "g",
                                        color: .green
                                    )
                                }
                            }
                            .padding()
                            .background(Color.gray.opacity(0.1))
                            .cornerRadius(8)
                        }
                    }
                    .padding(.vertical, 8)
                }
            }
            .navigationTitle("Add Food")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("Cancel") {
                        onCancel()
                    }
                }
                
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Add") {
                        onAdd(quantity)
                    }
                    .disabled(Double(quantity) == nil || Double(quantity)! <= 0)
                }
            }
        }
        .presentationDetents([.medium])
    }
}

#Preview {
    DetailView(modelContext: try! ModelContainer(for: Meal.self, UserProfile.self, FoodItem.self).mainContext)
}