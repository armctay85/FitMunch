import SwiftUI

struct PriceMemorySettingsView: View {
    @State private var optedIn = false
    @State private var priceCount = 0
    @State private var receipts: [(id: String, title: String, detail: String)] = []
    @State private var confirmOff = false
    @State private var confirmDelete: String?
    @State private var confirmAll = false

    init() {
        if PriceMemoryLaunch.isActive && !PriceMemoryLaunch.showEmpty {
            _optedIn = State(initialValue: true)
            _priceCount = State(initialValue: PriceMemoryLaunch.priceCount)
            _receipts = State(initialValue: [("r1", "Coles", "12 Sep · 4 items")])
        }
    }

    var body: some View {
        List {
            Section {
                Toggle("Price memory", isOn: Binding(
                    get: { optedIn },
                    set: { turn($0) }
                ))
                .accessibilityIdentifier("pm-toggle")
                Text(optedIn ? "On. New scans add to your price memory." : "Off. Your scans are not kept.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                Text("\(priceCount) prices from \(receipts.count) receipts · oldest 12 Sep")
                    .font(.footnote)
            }
            if optedIn && !receipts.isEmpty {
                Section("Your receipts") {
                    ForEach(receipts, id: \.id) { row in
                        HStack {
                            VStack(alignment: .leading) {
                                Text(row.title)
                                Text(row.detail).font(.caption).foregroundStyle(.secondary)
                            }
                            Spacer()
                            Button("Delete") { confirmDelete = row.id }
                                .foregroundStyle(.red)
                        }
                        .accessibilityIdentifier("pm-receipt-row")
                    }
                }
            }
            Section {
                Button("Download my prices") {}
                Button("Delete all price history", role: .destructive) { confirmAll = true }
                    .accessibilityIdentifier("pm-delete-all")
                Link("How price memory works", destination: URL(string: "https://www.fitmunch.com.au/privacy#price-memory")!)
            }
        }
        .navigationTitle("Price memory")
        .sheet(isPresented: $confirmOff) {
            VStack(alignment: .leading, spacing: 16) {
                Text("Turn off and delete \(priceCount) saved prices?")
                    .font(.title3.bold())
                    .accessibilityIdentifier("pm-opt-out-title")
                Text("Price memory stops straight away. Deleting removes the prices already saved on this account.")
                    .foregroundStyle(.secondary)
                Button("Turn off and delete", role: .destructive) {
                    optedIn = false
                    priceCount = 0
                    receipts = []
                    confirmOff = false
                }
                .frame(maxWidth: .infinity)
                Button("Keep it for now") {
                    optedIn = false
                    confirmOff = false
                }
                .frame(maxWidth: .infinity)
            }
            .padding()
            .presentationDetents([.medium])
        }
        .alert("Delete this receipt?", isPresented: Binding(
            get: { confirmDelete != nil },
            set: { if !$0 { confirmDelete = nil } }
        )) {
            Button("Delete", role: .destructive) {
                if let id = confirmDelete {
                    receipts.removeAll { $0.id == id }
                    priceCount = receipts.isEmpty ? 0 : priceCount
                }
                confirmDelete = nil
            }
            Button("Keep it for now", role: .cancel) { confirmDelete = nil }
        }
        .alert("Delete all price history?", isPresented: $confirmAll) {
            Button("Delete all", role: .destructive) {
                receipts = []
                priceCount = 0
            }
            Button("Keep it for now", role: .cancel) {}
        } message: {
            Text("Every saved receipt price on this account is removed.")
        }
    }

    private func turn(_ on: Bool) {
        if on {
            optedIn = true
            return
        }
        if priceCount == 0 {
            optedIn = false
            return
        }
        confirmOff = true
    }
}
