# Contributing to GameGuide-AI

Thank you for your interest in contributing to GameGuide-AI! We welcome bug reports, documentation updates, and improvements.

## Code of Conduct

Please maintain a professional, respectful, and collaborative environment. Treat all contributors with courtesy.

## Development Workflow

### 1. Fork & Branch

1. Fork the repository on GitHub.
2. Clone your fork locally:
   ```bash
   git clone https://github.com/<your-username>/GameGuide-AI.git
   cd GameGuide-AI
   ```
3. Create a feature branch:
   ```bash
   git checkout -b feat/your-feature-name
   ```

### 2. Local Environment Setup

1. Install dependencies:
   ```bash
   npm install
   ```
2. Copy environment templates:
   ```bash
   cp .env.example .env.local
   cp supabase/functions/.env.example supabase/functions/.env
   ```
3. Start development servers:
   ```bash
   npm run dev        # Web client (http://localhost:5173)
   npm run dev:api    # Local chat-proxy edge function (http://127.0.0.1:8000)
   ```

### 3. Testing & Validation

Before submitting changes, ensure all tests pass:

```bash
# Run unit & regression test suites
npm test

# Verify production build
npm run build

# Run linter
npm run lint
```

### 4. Commit Standards

We follow [Conventional Commits](https://www.conventionalcommits.org/):

- `feat(scope): add new capability`
- `fix(scope): resolve bug or issue`
- `test(scope): add or update test suites`
- `docs(scope): update documentation`
- `refactor(scope): internal code restructuring`
- `chore(scope): build, dependency, or tooling maintenance`

### 5. Pull Request Process

1. Push your branch to GitHub.
2. Open a Pull Request against the `main` branch.
3. Fill out the Pull Request template describing your changes, motivation, and verification steps.
4. Ensure CI checks pass.

Thank you for helping make GameGuide-AI better!
