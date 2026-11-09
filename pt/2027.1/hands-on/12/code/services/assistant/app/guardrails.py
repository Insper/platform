"""The safety mesh of the assistant: checks before the model (input) and after it (output)."""
import re

INJECTION = re.compile(
    r"ignore (all |any )?(the )?(previous|prior|above) (instructions|rules)"
    r"|disregard (the )?(system|previous) (prompt|instructions)"
    r"|(reveal|print|show) (me )?(your|the) (system prompt|instructions)"
    r"|you are now|developer mode|jailbreak",
    re.IGNORECASE,
)
PII = [  # replaced BEFORE the text reaches the model, the logs or a third-party provider
    (re.compile(r"\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b"), "[CPF]"),
    (re.compile(r"\b(?:\d[ -]?){13,16}\b"), "[CARD]"),
    (re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+"), "[EMAIL]"),
]
CITATION = re.compile(r"\[(event:\d+)\]")


class Blocked(Exception):
    def __init__(self, kind: str, message: str):
        super().__init__(message)
        self.kind = kind


def check_input(text: str, max_chars: int) -> str:
    """Reject what must never reach the model; redact what must not leave the system."""
    if not text.strip():
        raise Blocked("empty", "Please ask a question.")
    if len(text) > max_chars:
        raise Blocked("too_long", f"Please keep the question under {max_chars} characters.")
    if INJECTION.search(text):
        raise Blocked("prompt_injection", "I can only help with BoxOffice events, tickets and orders.")
    for pattern, label in PII:
        text = pattern.sub(label, text)
    return text


DONT_KNOW = re.compile(r"(don't|do not) know|não sei|no information|não encontrei", re.IGNORECASE)


def check_output(answer: str, evidence: set[str]) -> tuple[str, bool]:
    """Grounded = cites at least one document it received and no document it did not.

    Invented citations are replaced by "[unverified]"; "I don't know" needs no citation.
    """
    cited = set(CITATION.findall(answer))
    invented = cited - evidence
    for doc_id in invented:
        answer = answer.replace(f"[{doc_id}]", "[unverified]")
    grounded = not invented and (bool(cited) or bool(DONT_KNOW.search(answer)))
    return answer, grounded
