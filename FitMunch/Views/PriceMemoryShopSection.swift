import SwiftUI

extension Notification.Name {
    static let fitmunchSelectTab = Notification.Name("fitmunchSelectTab")
}

/// "Your shop" on the plan. Own receipt prices only, or a quiet empty card.
struct PriceMemoryShopSection: View {
    var body: some View {
        if ScreenshotLaunch.isActive {
            EmptyView()
        } else if PriceMemoryLaunch.showData {
            dataCard
        } else if PriceMemoryLaunch.showEmpty || PriceMemoryLaunch.isActive {
            emptyCard
        } else {
            emptyCard
        }
    }

    private var emptyCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            Image(systemName: "receipt")
                .font(.title2)
                .foregroundStyle(Color(red: 0.086, green: 0.639, blue: 0.290))
            Text("Your prices, from your receipts.")
                .font(.headline)
            Text("Scan a receipt and FitMunch remembers what you paid, item by item. Only you see it.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            Button("Scan your first receipt") {
                NotificationCenter.default.post(name: .fitmunchSelectTab, object: 2)
            }
            .buttonStyle(.borderedProminent)
            .tint(Color(red: 0.086, green: 0.639, blue: 0.290))
        }
        .padding()
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(.secondarySystemBackground))
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .accessibilityIdentifier("plan-price-empty")
    }

    private var dataCard: some View {
        let memo = PriceMemoryCopy.Memo(
            lastPaid: .init(cents: 1100, storeName: "Coles", purchasedOn: "2026-09-12", packLabel: "1 kg")
        )
        return VStack(alignment: .leading, spacing: 12) {
            Text("Your shop")
                .font(.headline)
            Text("Price memory · 4 prices from 1 receipt · last scan 12 Sep")
                .font(.caption)
                .foregroundStyle(.secondary)
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Chicken breast")
                    Text("1 kg")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer(minLength: 12)
                Text(PriceMemoryCopy.lastPaidLine(memo, now: Date()))
                    .font(.caption.monospacedDigit())
                    .multilineTextAlignment(.trailing)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityLabel(PriceMemoryCopy.voiceOver(memo, now: Date()))
                    .accessibilityIdentifier("plan-price-memo")
            }
            Text("Your last paid covers 1 of 1 items: A$11.00")
                .font(.subheadline)
            Text(PriceMemoryCopy.footnote)
                .font(.caption2)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding()
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(.secondarySystemBackground))
        .clipShape(RoundedRectangle(cornerRadius: 16))
    }
}
