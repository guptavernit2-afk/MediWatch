"""Validated API inputs. Bounds reject implausible sensor data, not clinical risk."""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

ShortText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)]
NameText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=2, max_length=100)]
ConditionText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=180)]
NoteText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=3000)]


class InputModel(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True, allow_inf_nan=False)


class ReadingCreate(InputModel):
    heart_rate: int = Field(ge=20, le=250)
    blood_pressure_sys: int = Field(ge=40, le=300)
    blood_pressure_dia: int = Field(ge=20, le=200)
    oxygen: float = Field(ge=50, le=100)
    temperature: float = Field(default=36.8, ge=30, le=43)
    respiratory_rate: int = Field(default=16, ge=4, le=70)

    @model_validator(mode="after")
    def pressure_order(self):
        if self.blood_pressure_sys <= self.blood_pressure_dia:
            raise ValueError("Systolic pressure must be greater than diastolic pressure.")
        return self


class PatientCreate(ReadingCreate):
    name: NameText
    age: int = Field(ge=18, le=120)
    sex: Literal["Male", "Female", "Other", "Not specified"] = "Not specified"
    ward: ShortText = "General"
    bed: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=20)]
    condition: ConditionText = "Observation"


class PatientUpdate(InputModel):
    name: NameText | None = None
    age: int | None = Field(default=None, ge=18, le=120)
    sex: Literal["Male", "Female", "Other", "Not specified"] | None = None
    ward: ShortText | None = None
    bed: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=20)] | None = None
    condition: ConditionText | None = None

    @model_validator(mode="after")
    def non_null_updates(self):
        if any(getattr(self, field) is None for field in self.model_fields_set):
            raise ValueError("Patient fields cannot be cleared to null.")
        return self


class NoteCreate(InputModel):
    content: NoteText
    author: ShortText = "Demo operator"


class AcknowledgeCreate(InputModel):
    acknowledged_by: ShortText = "Demo operator"
