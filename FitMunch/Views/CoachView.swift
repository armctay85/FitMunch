import SwiftUI

/// AI Coach chat — same brain as the web app, grounded in the user's account.
struct CoachView: View {
    @EnvironmentObject private var auth: AuthManager
    @State private var messages: [ChatMessage] = []
    @State private var input = ""
    @State private var intent = "general"
    @State private var isSending = false
    @State private var remaining: Int?
    @State private var showPaywall = false

    private let brandGreen = Color(red: 0.086, green: 0.639, blue: 0.290)
    private let intents: [(id: String, label: String)] = [
        ("general", "💬 General"),
        ("nutrition", "🥗 Nutrition"),
        ("workout", "🏋️ Training"),
        ("progress", "📈 Progress"),
    ]

    struct ChatMessage: Identifiable, Equatable {
        let id = UUID()
        let role: String // "user" | "assistant"
        var content: String
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                // Intent chips
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(intents, id: \.id) { item in
                            Button {
                                intent = item.id
                            } label: {
                                Text(item.label)
                                    .font(.footnote.weight(.semibold))
                                    .padding(.horizontal, 12)
                                    .padding(.vertical, 7)
                                    .background(intent == item.id ? brandGreen : Color(.secondarySystemBackground))
                                    .foregroundColor(intent == item.id ? .white : .primary)
                                    .clipShape(Capsule())
                            }
                        }
                    }
                    .padding(.horizontal)
                    .padding(.vertical, 8)
                }

                // Thread
                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(spacing: 10) {
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
                    .onChange(of: messages) { _, newValue in
                        if let last = newValue.last {
                            withAnimation { proxy.scrollTo(last.id, anchor: .bottom) }
                        }
                    }
                }

                // Composer
                HStack(spacing: 10) {
                    TextField("Ask your coach anything…", text: $input, axis: .vertical)
                        .lineLimit(1...4)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 10)
                        .background(Color(.secondarySystemBackground))
                        .clipShape(RoundedRectangle(cornerRadius: 20))
                        .onSubmit(send)
                    Button(action: send) {
                        Image(systemName: "arrow.up.circle.fill")
                            .font(.system(size: 32))
                            .foregroundColor(input.trimmingCharacters(in: .whitespaces).isEmpty || isSending ? .gray : brandGreen)
                    }
                    .disabled(input.trimmingCharacters(in: .whitespaces).isEmpty || isSending)
                }
                .padding(.horizontal)
                .padding(.vertical, 8)
            }
            .navigationTitle("AI Coach")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                if let remaining = remaining {
                    ToolbarItem(placement: .topBarTrailing) {
                        Text("\(remaining) left")
                            .font(.caption2)
                            .foregroundColor(.secondary)
                    }
                }
            }
            .sheet(isPresented: $showPaywall) {
                PaywallView()
            }
        }
    }

    private var emptyState: some View {
        VStack(spacing: 14) {
            Text("🤖").font(.system(size: 44))
            Text("Your AI training partner")
                .font(.headline)
            Text("It knows your goals and your logs. Try one of these:")
                .font(.footnote)
                .foregroundColor(.secondary)
            VStack(spacing: 8) {
                starter("What should I eat tonight to hit my protein target?")
                starter("Build me a cheap high-protein Woolies shop")
                starter("I keep snacking at 9pm. How do I stop?")
            }
        }
        .padding(.top, 40)
    }

    private func starter(_ text: String) -> some View {
        Button {
            input = text
            send()
        } label: {
            Text(text)
                .font(.footnote)
                .multilineTextAlignment(.leading)
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .frame(maxWidth: .infinity)
                .background(Color(.secondarySystemBackground))
                .foregroundColor(.primary)
                .clipShape(RoundedRectangle(cornerRadius: 12))
        }
    }

    private func bubble(_ message: ChatMessage) -> some View {
        HStack {
            if message.role == "user" { Spacer(minLength: 40) }
            Text(message.content)
                .font(.subheadline)
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .background(message.role == "user" ? brandGreen : Color(.secondarySystemBackground))
                .foregroundColor(message.role == "user" ? .white : .primary)
                .clipShape(RoundedRectangle(cornerRadius: 16))
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
                    messages[typingIndex] = ChatMessage(role: "assistant",
                        content: res.error ?? "You've used this month's free AI actions.")
                    showPaywall = true
                } else {
                    messages[typingIndex] = ChatMessage(role: "assistant",
                        content: res.error ?? "That didn't work — try again in a moment.")
                }
            } catch {
                let apiError = error as? APIError
                messages[typingIndex] = ChatMessage(role: "assistant",
                    content: apiError?.errorDescription ?? "Network hiccup — try again.")
                if case .server(let text)? = apiError, text.lowercased().contains("upgrade") {
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
