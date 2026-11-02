"""
Antigravity AI — Saga Pattern
Orchestration-based saga for the EV route computation pipeline.
"""

import uuid
from dataclasses import dataclass, field
from typing import Any, Callable, Optional


@dataclass
class SagaStep:
    name: str
    execute: Callable
    compensate: Callable
    result: Any = None
    completed: bool = False
    error: Optional[Exception] = None


class RouteSaga:
    """
    Orchestration-based saga for the EV route computation pipeline.
    Steps execute in order; on failure, compensations run in reverse.
    """

    def __init__(self, request_id: str = None):
        self.saga_id = request_id or str(uuid.uuid4())[:8]
        self.steps: list[SagaStep] = []
        self.context: dict = {}
        self.failed_at: Optional[str] = None

    def add_step(self, name, execute, compensate=None):
        self.steps.append(SagaStep(
            name=name,
            execute=execute,
            compensate=compensate or (lambda ctx: None),
        ))
        return self

    async def run(self) -> dict:
        print(f"[Saga:{self.saga_id}] Starting route computation saga")
        completed_steps = []

        for step in self.steps:
            try:
                print(f"[Saga:{self.saga_id}] Executing: {step.name}")
                step.result = await step.execute(self.context)
                step.completed = True
                self.context[step.name] = step.result
                completed_steps.append(step)
            except Exception as e:
                step.error = e
                self.failed_at = step.name
                print(f"[Saga:{self.saga_id}] FAILED at {step.name}: {e}")

                for done_step in reversed(completed_steps):
                    try:
                        print(f"[Saga:{self.saga_id}] Compensating: {done_step.name}")
                        await done_step.compensate(self.context)
                    except Exception as comp_err:
                        print(f"[Saga:{self.saga_id}] Compensation failed for {done_step.name}: {comp_err}")

                return {
                    "success": False,
                    "failed_at": self.failed_at,
                    "error": str(e),
                    "saga_id": self.saga_id,
                }

        print(f"[Saga:{self.saga_id}] Completed successfully")
        return {
            "success": True,
            "context": self.context,
            "saga_id": self.saga_id,
        }
