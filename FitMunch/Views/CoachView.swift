import SwiftUI

/// AI Coach chat. Same brain as the web app, grounded in the user's account.
struct CoachView: View {
    @EnvironmentObject private var auth: AuthManager
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var messages: [ChatMessage] = []
    @State private var input = ""
    @State private var intent = "general"
    @State private var isSending = false
    @State private var remaining: Int?
    @State private var showPaywall = false
    @State private var freeLimitHits = 0

    private let intents: [(id: String, label: String)] = [
        ("general", "General"),
        ("nutrition", "Nutrition"),
        ("workout", "Training"),
        ("progress", "Progress"),
    ]

    struct ChatMessage: Identifiable, Equatable {
        let id = UUID()
        let role: String
        var content: String
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                OfflineNotice()
                    .padding(.horizontal, Theme.Spacing.four)
                    .padding(.top, Theme.Spacing.two)

                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: Theme.Spacing.two) {
                        ForEach(intents, id: \.id) { item in
                            Button {
                                intent = item.id
                            } label: {
                                Text(item.label)
                                    .font(.footnote.weight(.semibold))
                                    .lineLimit(1)
                                    .minimumScaleFactor(0.8)
                                    .padding(.horizontal, Theme.Spacing.three)
                                    .padding(.vertical, 7)
                                    .background(intent == item.id ? Theme.buttonFill : Color(.secondarySystemBackground))
                                    .foregroundStyle(intent == item.id ? Color.white : Color.primary)
                                    .clipShape(Capsule())
                            }
                            .accessibilityAddTraits(intent == item.id ? .isSelected : [])
                        }
                    }
                    .padding(.horizontal)
                    .padding(.vertical, Theme.Spacing.two)
                }
                .sensoryFeedback(.selection, trigger: intent)

                ScrollViewReader { proxy in
                    ScrollView {
                        VStack(spacing: 10) {
                            if messages.isEmpty {
                                emptyState
                            }
                            ForEach(messages) { message in
                                bubble(message)
                                    .id(message.id)
                            }
                        }
                        .padding()
                    }
                    .scrollClearsTabBar()
                    .onChange(of: messages) { _, newValue in
                        guard !ScreenshotLaunch.isActive, let last = newValue.last else { return }
                        if reduceMotion {
                            proxy.scrollTo(last.id, anchor: .bottom)
                        } else {
                            withAnimation { proxy.scrollTo(last.id, anchor: .bottom) }
                        }
                    }
                }

                HStack(spacing: 10) {
                    TextField("Ask your coach anything…", text: $input, axis: .vertical)
                        .lineLimit(1...4)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 10)
                        .background(Color(.secondarySystemBackground))
                        .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
                        .onSubmit(send)
                        .accessibilityIdentifier("coach-input")
                    Button(action: send) {
                        Image(systemName: "arrow.up.circle.fill")
                            .font(.system(size: 32))
                            .symbolRenderingMode(.hierarchical)
                            .foregroundStyle(input.trimmingCharacters(in: .whitespaces).isEmpty || isSending ? Color.secondary : Theme.brandGreen)
                    }
                    .disabled(input.trimmingCharacters(in: .whitespaces).isEmpty || isSending)
                    .accessibilityLabel("Send")
                    .accessibilityIdentifier("coach-send")
                }
                .padding(.horizontal)
                .padding(.vertical, Theme.Spacing.two)
                .background(Theme.surface)
            }
            .background(Theme.surface)
            .navigationTitle("Coach")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                if let remaining {
                    ToolbarItem(placement: .topBarTrailing) {
                        Text("\(remaining) left")
                            .font(.caption2.monospacedDigit())
                            .foregroundStyle(.secondary)
                    }
                }
            }
            .sensoryFeedback(.warning, trigger: freeLimitHits)
            .fullScreenCover(isPresented: $showPaywall) {
                PaywallView()
            }
            .onAppear {
                if ScreenshotLaunch.isActive && messages.isEmpty {
                    messages = ScreenshotLaunch.coachMessages()
                }
            }
        }
    }

    private var emptyState: some View {
        ContentUnavailableView {
            VStack(spacing: Theme.Spacing.three) {
                Image(systemName: "sparkles")
                    .font(.system(size: 44))
                    .symbolRenderingMode(.hierarchical)
                    .foregroundStyle(Theme.brandGreen)
                Text("Your AI training partner")
                    .font(.headline)
            }
        } description: {
            Text("It knows your goals and your logs. Try one of these:")
        } actions: {
            VStack(spacing: Theme.Spacing.two) {
                starter("What should I eat tonight to hit my protein target?")
                starter("Build me a high-protein week for my macros")
                starter("I keep snacking at 9pm. How do I stop?")
            }
        }
        .padding(.top, Theme.Spacing.four)
    }

    private func starter(_ text: String) -> some View {
        suggestionChip(text)
    }

    private func suggestionChip(_ text: String) -> some View {
        Button {
            input = text
            send()
        } label: {
            Text(text)
                .font(.footnote.weight(.semibold))
                .multilineTextAlignment(.leading)
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Theme.brandGreenSoft)
                .foregroundStyle(.primary)
                .clipShape(Capsule())
        }
        .accessibilityIdentifier("coach-suggestion")
    }

    private func bubble(_ message: ChatMessage) -> some View {
        HStack {
            if message.role == "user" { Spacer(minLength: 40) }
            Text(message.content)
                .font(.subheadline)
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .background(message.role == "user" ? Theme.buttonFill : Color(.secondarySystemBackground))
                .foregroundStyle(message.role == "user" ? Color.white : Color.primary)
                .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.large, style: .continuous))
            if message.role != "user" { Spacer(minLength: 40) }
        }
    }

    private func send() {
        let text = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, !isSending else { return }
        input = ""
        messages.append(ChatMessage(role: "user", content: text))
        let typingIndex = messages.count
        messages.append(ChatMessage(role: "assistant", content: "…"))
        isSending = true

        let history = messages.prefix(typingIndex).suffix(12).map { ["role": $0.role, "content": $0.content] }

        Task {
            defer { isSending = false }
            do {
                let res = try await APIClient.request(
                    "/ai/chat",
                    method: "POST",
                    body: ["intent": intent, "messages": Array(history)],
                    as: ChatResponse.self
                )
                if res.success, let reply = res.reply {
                    messages[typingIndex] = ChatMessage(role: "assistant", content: reply)
                    remaining = res.remaining
                } else if res.upgrade == true {
                    freeLimitHits += 1
                    messages[typingIndex] = ChatMessage(role: "assistant",
                        content: res.error ?? "You've used this month's free AI actions.")
                    showPaywall = true
                } else {
                    messages[typingIndex] = ChatMessage(role: "assistant",
                        content: res.error ?? "That didn't work. Try again in a moment.")
                }
            } catch {
                let apiError = error as? APIError
                messages[typingIndex] = ChatMessage(role: "assistant",
                    content: apiError?.errorDescription ?? "Network hiccup. Try again.")
                if case .server(let text)? = apiError, text.lowercased().contains("upgrade") {
                    freeLimitHits += 1
                    showPaywall = true
                }
            }
        }
    }
}

#Preview {
    CoachView()
        .environmentObject(AuthManager.shared)
}
