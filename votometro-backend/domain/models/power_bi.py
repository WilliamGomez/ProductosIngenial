from dataclasses import dataclass, field
from typing import List


@dataclass
class Report:
    report_id: str
    embed_url: str
    name: str


@dataclass
class PowerBI:
    token: str
    reports: List[Report] = field(default_factory=list)
