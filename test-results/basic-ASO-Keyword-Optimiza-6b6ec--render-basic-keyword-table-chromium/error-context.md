# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - generic [ref=e3]:
    - generic [ref=e4]:
      - generic [ref=e5]: ASO Keyword Optimization
      - generic [ref=e6]: Welcome back
    - generic [ref=e8]:
      - button "Continue with Google" [ref=e9]:
        - img
        - text: Continue with Google
      - generic [ref=e14]: Or continue with email
      - generic [ref=e15]:
        - generic [ref=e16]:
          - generic [ref=e17]: Email
          - textbox "Email" [ref=e18]:
            - /placeholder: m@example.com
        - generic [ref=e19]:
          - generic [ref=e20]: Password
          - textbox "Password" [ref=e21]
        - button "Sign In" [ref=e22]
    - generic [ref=e24]:
      - text: Don't have an account?
      - button "Sign up" [ref=e25]
  - region "Notifications alt+T"
  - button "Open Next.js Dev Tools" [ref=e31] [cursor=pointer]:
    - img [ref=e32]
  - alert [ref=e35]
```