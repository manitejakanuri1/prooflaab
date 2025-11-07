# End-to-End Verification Test Script

This script tests the complete cognitive integrity verification flow from GitHub analysis to trust score computation.

## Prerequisites

1. **Supabase Project**: zlfjxcwltqtajnczfjjp
2. **API Keys**: GITHUB_PAT, GEMINI_API_KEY configured in Supabase secrets
3. **Sample Data**:
   - Student profile ID
   - Task ID
   - Public GitHub repo URL (e.g., `https://github.com/username/sample-project`)

## Environment Setup

```bash
export SUPABASE_URL="https://zlfjxcwltqtajnczfjjp.supabase.co"
export SUPABASE_ANON_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpsZmp4Y3dsdHF0YWpuY3pmampwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTEyODUzNDUsImV4cCI6MjA2Njg2MTM0NX0.KnW8HvUSMpPFj2pAEbuLZvSsf808KYcqXbQ-p3S1sOY"

# Get your auth token after logging in
export AUTH_TOKEN="your-jwt-token-here"
```

## Test Flow

### Step 0: Create Test Proof Submission

```bash
# Create a proof submission for testing
curl -X POST "${SUPABASE_URL}/rest/v1/proof_uploads" \
  -H "apikey: ${SUPABASE_ANON_KEY}" \
  -H "Authorization: Bearer ${AUTH_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "student_id": "student-uuid-here",
    "task_id": "task-uuid-here",
    "file_url": "https://github.com/username/sample-project",
    "submission_notes": "E2E Test Submission",
    "status": "Under Review"
  }'

# Save the returned proof_id
export PROOF_ID="returned-proof-id-here"
```

### Step 1: Run GitHub Verification

```bash
curl -X POST "${SUPABASE_URL}/functions/v1/github-check" \
  -H "Authorization: Bearer ${AUTH_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "proof_id": "'${PROOF_ID}'",
    "repo_url": "https://github.com/username/sample-project"
  }' | jq '.'
```

**Expected Output:**
```json
{
  "success": true,
  "proof_id": "...",
  "authenticity_score": 75,
  "commit_count": 15,
  "unique_contributors": 1,
  "first_commit_at": "2024-01-15T10:30:00Z",
  "last_commit_at": "2024-02-20T15:45:00Z"
}
```

**Verify in audit_logs:**
```bash
curl "${SUPABASE_URL}/rest/v1/audit_logs?action=eq.github_verification_completed&record_id=eq.${PROOF_ID}&order=created_at.desc&limit=1" \
  -H "apikey: ${SUPABASE_ANON_KEY}" \
  -H "Authorization: Bearer ${AUTH_TOKEN}" | jq '.'
```

### Step 2: Run AI Authorship Analysis

```bash
curl -X POST "${SUPABASE_URL}/functions/v1/ai-authorship" \
  -H "Authorization: Bearer ${AUTH_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "proof_id": "'${PROOF_ID}'",
    "code_snippets_or_repo_summary": "Sample code analysis for repository"
  }' | jq '.'
```

**Expected Output:**
```json
{
  "success": true,
  "proof_id": "...",
  "ai_authorship_risk": 25,
  "originality_score": 75,
  "explanation": "Code shows human patterns...",
  "ai_summary": "Low AI-generation likelihood"
}
```

**Verify in audit_logs:**
```bash
curl "${SUPABASE_URL}/rest/v1/audit_logs?action=eq.ai_verification_completed&record_id=eq.${PROOF_ID}&order=created_at.desc&limit=1" \
  -H "apikey: ${SUPABASE_ANON_KEY}" \
  -H "Authorization: Bearer ${AUTH_TOKEN}" | jq '.'
```

### Step 3: Generate Conceptual Questions

```bash
curl -X POST "${SUPABASE_URL}/functions/v1/question-generator" \
  -H "Authorization: Bearer ${AUTH_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "proof_id": "'${PROOF_ID}'",
    "repo_url": "https://github.com/username/sample-project",
    "top_n": 3
  }' | jq '.'
```

**Expected Output:**
```json
{
  "success": true,
  "proof_id": "...",
  "questions": [
    {
      "id": "q1",
      "prompt": "Explain the design choice behind...",
      "context_references": ["file.js:45", "main.py:120"],
      "difficulty": "medium",
      "time_limit_seconds": 120
    }
  ]
}
```

**Verify conceptual_tests table:**
```bash
curl "${SUPABASE_URL}/rest/v1/conceptual_tests?proof_id=eq.${PROOF_ID}&select=*" \
  -H "apikey: ${SUPABASE_ANON_KEY}" \
  -H "Authorization: Bearer ${AUTH_TOKEN}" | jq '.'
```

### Step 4: Submit Student Answers (Simulate)

```bash
curl -X POST "${SUPABASE_URL}/functions/v1/submit-conceptual-answers" \
  -H "Authorization: Bearer ${AUTH_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "proof_id": "'${PROOF_ID}'",
    "answers": [
      {
        "question_id": "q1",
        "answer_text": "The design choice was made to optimize performance by using async/await patterns. This allows for non-blocking I/O operations and better scalability. I implemented this in commit abc123 where I refactored the main function to use promises."
      },
      {
        "question_id": "q2",
        "answer_text": "I handled edge cases by adding validation checks in the input processing function. Lines 45-60 show the validation logic where I check for null values and invalid input formats."
      },
      {
        "question_id": "q3",
        "answer_text": "The architecture follows MVC pattern to separate concerns. The controller handles requests, model manages data, and view renders output. This makes the codebase more maintainable and testable."
      }
    ]
  }' | jq '.'
```

**Expected Output:**
```json
{
  "success": true,
  "submitted_count": 3,
  "proof_id": "..."
}
```

**Verify in audit_logs:**
```bash
curl "${SUPABASE_URL}/rest/v1/audit_logs?action=eq.conceptual_answers_submitted&record_id=eq.${PROOF_ID}&order=created_at.desc&limit=1" \
  -H "apikey: ${SUPABASE_ANON_KEY}" \
  -H "Authorization: Bearer ${AUTH_TOKEN}" | jq '.'
```

### Step 5: Evaluate Conceptual Answers

```bash
curl -X POST "${SUPABASE_URL}/functions/v1/response-evaluator" \
  -H "Authorization: Bearer ${AUTH_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "proof_id": "'${PROOF_ID}'"
  }' | jq '.'
```

**Expected Output:**
```json
{
  "success": true,
  "proof_id": "...",
  "conceptual_understanding_score": 78,
  "answer_scores": [
    {
      "question_id": "q1",
      "correctness_score": 85,
      "ai_likelihood_score": 20,
      "confidence": 90,
      "explanation": "Strong understanding shown...",
      "repo_context_bonus": 15,
      "final_score": 80
    }
  ],
  "status": "completed"
}
```

**Verify in audit_logs:**
```bash
curl "${SUPABASE_URL}/rest/v1/audit_logs?action=eq.conceptual_answers_evaluated&record_id=eq.${PROOF_ID}&order=created_at.desc&limit=1" \
  -H "apikey: ${SUPABASE_ANON_KEY}" \
  -H "Authorization: Bearer ${AUTH_TOKEN}" | jq '.'
```

### Step 6: Compute Trust Score (Final)

```bash
curl -X POST "${SUPABASE_URL}/functions/v1/trust-compute" \
  -H "Authorization: Bearer ${AUTH_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "proof_id": "'${PROOF_ID}'"
  }' | jq '.'
```

**Expected Output:**
```json
{
  "success": true,
  "proof_id": "...",
  "student_id": "...",
  "commit_authenticity_score": 75,
  "ai_authorship_score": 75,
  "conceptual_understanding_score": 78,
  "cognitive_integrity_score": 76,
  "suggested_action": "verified",
  "summary": "High cognitive integrity (76/100). All verifications passed with strong scores. Recommended for automatic approval."
}
```

**Verify in audit_logs:**
```bash
curl "${SUPABASE_URL}/rest/v1/audit_logs?action=eq.trust_score_computed&record_id=eq.${PROOF_ID}&order=created_at.desc&limit=1" \
  -H "apikey: ${SUPABASE_ANON_KEY}" \
  -H "Authorization: Bearer ${AUTH_TOKEN}" | jq '.'
```

### Verification Checks

**1. Check proof_uploads status:**
```bash
curl "${SUPABASE_URL}/rest/v1/proof_uploads?id=eq.${PROOF_ID}&select=*" \
  -H "apikey: ${SUPABASE_ANON_KEY}" \
  -H "Authorization: Bearer ${AUTH_TOKEN}" | jq '.'
```

Expected fields:
- `admin_review_status`: "Approved"
- `ai_summary`: "High cognitive integrity..."
- `ai_score`: 76

**2. Check trust_scores table:**
```bash
curl "${SUPABASE_URL}/rest/v1/trust_scores?select=*&order=last_updated.desc&limit=1" \
  -H "apikey: ${SUPABASE_ANON_KEY}" \
  -H "Authorization: Bearer ${AUTH_TOKEN}" | jq '.'
```

**3. Check all audit logs for this proof:**
```bash
curl "${SUPABASE_URL}/rest/v1/audit_logs?record_id=eq.${PROOF_ID}&order=created_at.asc" \
  -H "apikey: ${SUPABASE_ANON_KEY}" \
  -H "Authorization: Bearer ${AUTH_TOKEN}" | jq '.'
```

Expected audit log actions in order:
1. `github_verification_completed`
2. `ai_verification_completed`
3. `questions_generated`
4. `conceptual_answers_submitted`
5. `conceptual_answers_evaluated`
6. `trust_score_computed`

## Success Criteria

✅ All 6 edge functions execute without errors
✅ All audit logs are created with correct actions
✅ GitHub verification returns commit data
✅ AI authorship analysis returns risk score
✅ Questions are generated and saved to conceptual_tests
✅ Student answers are submitted and status changes to 'submitted'
✅ Answer evaluation completes and provides scores
✅ Trust score is computed and saved to trust_scores table
✅ proof_uploads.admin_review_status is updated
✅ Student profile trust_score is updated

## Troubleshooting

**GitHub API Rate Limit:**
- Check GitHub PAT token is valid
- Ensure repo URL is public or PAT has access

**Gemini API Errors:**
- Verify GEMINI_API_KEY is configured
- Check API quota limits

**Missing Data:**
- Ensure student_id exists in student_profiles
- Ensure task_id exists in tasks table
- Verify RLS policies allow the operations

**Timeout Issues:**
- Increase edge function timeout in config
- Break down large repos into smaller chunks

## Postman Collection

Import this collection for easier testing:

```json
{
  "info": {
    "name": "ProofLab Verification E2E",
    "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
  },
  "variable": [
    {
      "key": "supabase_url",
      "value": "https://zlfjxcwltqtajnczfjjp.supabase.co"
    },
    {
      "key": "auth_token",
      "value": "your-jwt-token"
    },
    {
      "key": "proof_id",
      "value": ""
    }
  ],
  "item": [
    {
      "name": "1. GitHub Check",
      "request": {
        "method": "POST",
        "header": [
          {
            "key": "Authorization",
            "value": "Bearer {{auth_token}}"
          }
        ],
        "body": {
          "mode": "raw",
          "raw": "{\n  \"proof_id\": \"{{proof_id}}\",\n  \"repo_url\": \"https://github.com/username/repo\"\n}",
          "options": {
            "raw": {
              "language": "json"
            }
          }
        },
        "url": {
          "raw": "{{supabase_url}}/functions/v1/github-check",
          "host": ["{{supabase_url}}"],
          "path": ["functions", "v1", "github-check"]
        }
      }
    }
  ]
}
```
