import SwiftUI

/// Sign in / create account. Same accounts as fitmunch.com.au.
struct AuthView: View {
    @EnvironmentObject private var auth: AuthManager
    @State private var mode: Mode = AuditLaunch.isAuthError ? .login : .register
    @State private var name = ""
    @State private var email = ""
    @State private var password = ""
    @FocusState private var focused: Field?

    enum Mode { case login, register }
    enum Field { case name, email, password }

    var body: some View {
        ZStack {
            Theme.surface.ignoresSafeArea()

            ScrollViewReader { proxy in
            ScrollView {
                VStack(spacing: 22) {
                    VStack(spacing: 10) {
                        Image(systemName: "leaf.circle.fill")
                            .font(.system(size: 56))
                            .symbolRenderingMode(.hierarchical)
                            .foregroundStyle(Theme.brandGreen)
                        HStack(spacing: 0) {
                            Text("Fit").foregroundStyle(.primary)
                            Text("Munch").foregroundStyle(Theme.brandGreen)
                        }
                        .font(.system(size: 30, weight: .heavy, design: .rounded))
                        Text("Your AI health partner")
                            .font(.subheadline)
                            .foregroundStyle(Theme.fmSecondary)
                    }
                    .padding(.top, 48)

                    Picker("Account", selection: $mode) {
                        Text("Sign In")
                            .lineLimit(1)
                            .minimumScaleFactor(0.8)
                            .tag(Mode.login)
                        Text("Create Account")
                            .lineLimit(1)
                            .minimumScaleFactor(0.8)
                            .tag(Mode.register)
                    }
                    .pickerStyle(.segmented)
                    .padding(.horizontal, 28)
                    .sensoryFeedback(.selection, trigger: mode)

                    VStack(alignment: .leading, spacing: 8) {
                        VStack(spacing: 12) {
                            if mode == .register {
                                field("Your name", text: $name, focus: .name, showsError: auth.errorMessage != nil)
                                    .textContentType(.name)
                            }
                            field("Email", text: $email, focus: .email, showsError: auth.errorMessage != nil)
                                .textContentType(.emailAddress)
                                .keyboardType(.emailAddress)
                                .textInputAutocapitalization(.never)
                                .autocorrectionDisabled()
                                .accessibilityIdentifier("auth-email")
                            secureField("Password (min. 8 characters)", text: $password, showsError: auth.errorMessage != nil)
                                .accessibilityIdentifier("auth-password")
                        }
                        if let error = auth.errorMessage {
                            HStack(alignment: .firstTextBaseline, spacing: 6) {
                                Image(systemName: "exclamationmark.circle.fill")
                                Text(error)
                                    .multilineTextAlignment(.leading)
                                    .accessibilityIdentifier("auth-error")
                            }
                            .font(.footnote.weight(.semibold))
                            .foregroundStyle(Theme.fmError)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .id("auth-error")
                        }
                    }
                    .padding(.horizontal, 28)

                    Button(action: submit) {
                        Text(mode == .login ? "Sign In" : "Create Free Account")
                            .foregroundStyle(Color.white)
                            .tint(.white)
                    }
                    .buttonStyle(PrimaryButtonStyle())
                    .tint(.white)
                    .disabled(auth.isLoading || !formValid)
                    .padding(.horizontal, 28)
                    .accessibilityIdentifier(mode == .login ? "auth-sign-in" : "auth-create-account")

                    Text("Free to start. Premium trial available in-app.")
                        .font(.footnote)
                        .foregroundStyle(Theme.fmSecondary)
                        .padding(.bottom, 32)
                }
            }
            .scrollClearsTabBar()
            .onAppear {
                guard auth.errorMessage != nil else { return }
                focused = .password
                proxy.scrollTo("auth-error", anchor: .center)
            }
            .onChange(of: auth.errorMessage) { _, message in
                guard message != nil else { return }
                focused = mode == .login ? .password : .email
                proxy.scrollTo("auth-error", anchor: .center)
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
        let signingIn = mode == .login
        Task {
            let ok: Bool
            if signingIn {
                ok = await auth.login(email: email.trimmingCharacters(in: .whitespaces).lowercased(),
                                     password: password)
            } else {
                ok = await auth.register(name: name.trimmingCharacters(in: .whitespaces),
                                        email: email.trimmingCharacters(in: .whitespaces).lowercased(),
                                        password: password)
            }
            if !ok {
                focused = signingIn ? .password : .email
            }
        }
    }

    private func field(_ placeholder: String, text: Binding<String>, focus: Field, showsError: Bool) -> some View {
        TextField("", text: text, prompt: Text(placeholder).foregroundStyle(.secondary))
            .focused($focused, equals: focus)
            .padding(14)
            .background(Color(.secondarySystemBackground))
            .foregroundStyle(.primary)
            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(showsError ? Theme.fmError : Color(.separator), lineWidth: 1))
    }

    private func secureField(_ placeholder: String, text: Binding<String>, showsError: Bool) -> some View {
        SecureField("", text: text, prompt: Text(placeholder).foregroundStyle(.secondary))
            .focused($focused, equals: .password)
            .textContentType(mode == .login ? .password : .newPassword)
            .padding(14)
            .background(Color(.secondarySystemBackground))
            .foregroundStyle(.primary)
            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(showsError ? Theme.fmError : Color(.separator), lineWidth: 1))
    }
}

#Preview {
    AuthView().environmentObject(AuthManager.shared)
}
