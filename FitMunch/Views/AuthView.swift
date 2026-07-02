import SwiftUI

/// Sign in / create account — same accounts as fitmunch.com.au.
struct AuthView: View {
    @EnvironmentObject private var auth: AuthManager
    @State private var mode: Mode = .register
    @State private var name = ""
    @State private var email = ""
    @State private var password = ""
    @FocusState private var focused: Field?

    enum Mode { case login, register }
    enum Field { case name, email, password }

    private let brandGreen = Color(red: 0.086, green: 0.639, blue: 0.290) // #16a34a

    var body: some View {
        ZStack {
            Color(red: 0.04, green: 0.07, blue: 0.04).ignoresSafeArea()

            ScrollView {
                VStack(spacing: 22) {
                    // Wordmark
                    VStack(spacing: 10) {
                        Image(systemName: "leaf.circle.fill")
                            .font(.system(size: 56))
                            .foregroundStyle(.white, brandGreen)
                        HStack(spacing: 0) {
                            Text("Fit").foregroundColor(.white)
                            Text("Munch").foregroundColor(brandGreen)
                        }
                        .font(.system(size: 30, weight: .heavy, design: .rounded))
                        Text("Your AI health partner")
                            .font(.footnote)
                            .foregroundColor(.white.opacity(0.6))
                    }
                    .padding(.top, 48)

                    // Mode toggle
                    Picker("", selection: $mode) {
                        Text("Sign In").tag(Mode.login)
                        Text("Create Account").tag(Mode.register)
                    }
                    .pickerStyle(.segmented)
                    .padding(.horizontal, 28)

                    VStack(spacing: 12) {
                        if mode == .register {
                            field("Your name", text: $name, focus: .name)
                                .textContentType(.name)
                        }
                        field("Email", text: $email, focus: .email)
                            .textContentType(.email)
                            .keyboardType(.emailAddress)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                        secureField("Password (min. 8 characters)", text: $password)
                    }
                    .padding(.horizontal, 28)

                    if let error = auth.errorMessage {
                        Text(error)
                            .font(.footnote)
                            .foregroundColor(.red)
                            .multilineTextAlignment(.center)
                            .padding(.horizontal, 28)
                    }

                    Button(action: submit) {
                        HStack {
                            if auth.isLoading { ProgressView().tint(.white) }
                            Text(mode == .login ? "Sign In" : "Create Free Account")
                                .fontWeight(.bold)
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 15)
                        .background(brandGreen)
                        .foregroundColor(.white)
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                    }
                    .disabled(auth.isLoading || !formValid)
                    .opacity(formValid ? 1 : 0.6)
                    .padding(.horizontal, 28)

                    if mode == .login {
                        Link("Forgot your password?",
                             destination: URL(string: "https://www.fitmunch.com.au/login.html")!)
                            .font(.footnote)
                            .foregroundColor(.white.opacity(0.65))
                    }

                    Text("Free to start · 14-day Premium trial, no card needed")
                        .font(.caption2)
                        .foregroundColor(.white.opacity(0.45))
                        .padding(.bottom, 32)
                }
            }
        }
        .onChange(of: mode) { _, _ in auth.errorMessage = nil }
    }

    private var formValid: Bool {
        let emailOk = email.contains("@") && email.contains(".")
        let passOk = password.count >= 8
        return mode == .login ? (emailOk && !password.isEmpty) : (!name.isEmpty && emailOk && passOk)
    }

    private func submit() {
        focused = nil
        Task {
            if mode == .login {
                _ = await auth.login(email: email.trimmingCharacters(in: .whitespaces).lowercased(),
                                     password: password)
            } else {
                _ = await auth.register(name: name.trimmingCharacters(in: .whitespaces),
                                        email: email.trimmingCharacters(in: .whitespaces).lowercased(),
                                        password: password)
            }
        }
    }

    private func field(_ placeholder: String, text: Binding<String>, focus: Field) -> some View {
        TextField("", text: text, prompt: Text(placeholder).foregroundColor(.white.opacity(0.35)))
            .focused($focused, equals: focus)
            .padding(14)
            .background(Color.white.opacity(0.07))
            .foregroundColor(.white)
            .clipShape(RoundedRectangle(cornerRadius: 10))
            .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color.white.opacity(0.12)))
    }

    private func secureField(_ placeholder: String, text: Binding<String>) -> some View {
        SecureField("", text: text, prompt: Text(placeholder).foregroundColor(.white.opacity(0.35)))
            .focused($focused, equals: .password)
            .textContentType(mode == .login ? .password : .newPassword)
            .padding(14)
            .background(Color.white.opacity(0.07))
            .foregroundColor(.white)
            .clipShape(RoundedRectangle(cornerRadius: 10))
            .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color.white.opacity(0.12)))
    }
}

#Preview {
    AuthView().environmentObject(AuthManager.shared)
}
