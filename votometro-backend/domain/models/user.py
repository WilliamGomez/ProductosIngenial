from dataclasses import dataclass, field
from typing import Optional, List
from datetime import datetime
from domain.models.product import Product


@dataclass
class User:
    display_name: str
    email: str
    phone: str
    enable: bool = True
    id: Optional[str] = None
    department: str = "IngenialAI"
    role: str = "User"
    password: str = None
    type_person: str = None
    type_dni: str = None
    identity_document: str = None
    reference: str = None
    reference2: str = None
    personal_email: str = None
    created_at: Optional[datetime] = None
    products: List[Product] = field(default_factory=list)
