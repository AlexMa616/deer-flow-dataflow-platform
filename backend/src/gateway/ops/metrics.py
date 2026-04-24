import threading
from dataclasses import dataclass
from datetime import datetime


@dataclass
class EndpointMetrics:
    count: int = 0
    error_count: int = 0
    total_latency_ms: float = 0.0
    max_latency_ms: float = 0.0
    last_status: int = 0
    last_seen: str | None = None

    def record(self, status: int, latency_ms: float) -> None:
        self.count += 1
        if status >= 400:
            self.error_count += 1
        self.total_latency_ms += latency_ms
        self.max_latency_ms = max(self.max_latency_ms, latency_ms)
        self.last_status = status
        self.last_seen = datetime.utcnow().isoformat() + "Z"

    @property
    def avg_latency_ms(self) -> float:
        if self.count == 0:
            return 0.0
        return self.total_latency_ms / self.count


class MetricsStore:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._total_requests = 0
        self._total_errors = 0
        self._by_path: dict[str, EndpointMetrics] = {}

    def record(self, path: str, status: int, latency_ms: float) -> None:
        with self._lock:
            self._total_requests += 1
            if status >= 400:
                self._total_errors += 1
            metric = self._by_path.setdefault(path, EndpointMetrics())
            metric.record(status, latency_ms)

    def snapshot(self) -> dict:
        with self._lock:
            return {
                "total_requests": self._total_requests,
                "total_errors": self._total_errors,
                "by_path": {
                    path: {
                        "count": metric.count,
                        "error_count": metric.error_count,
                        "avg_latency_ms": round(metric.avg_latency_ms, 2),
                        "max_latency_ms": round(metric.max_latency_ms, 2),
                        "last_status": metric.last_status,
                        "last_seen": metric.last_seen,
                    }
                    for path, metric in self._by_path.items()
                },
            }


_metrics_store = MetricsStore()


def get_metrics_store() -> MetricsStore:
    return _metrics_store
