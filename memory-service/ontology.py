"""Care-domain ontology for neo4j-agent-memory.

Labels are deliberately distinct from the medication graph (Patient, Medication,
ActiveIngredient, Food, Condition ...) so memory nodes never collide with it.
Memory entities are tied to the real graph with our own (:Entity)-[:REFERS_TO]->(node) edges.
"""

from neo4j_agent_memory.ontology import DomainInfo, EntityTypeDef, OntologyDocument, RelationshipDef

CARE_RECIPIENT = "CareRecipient"
CAREGIVER = "Caregiver"
MENTIONED_DRUG = "MentionedDrug"
MENTIONED_FOOD = "MentionedFood"
MENTIONED_CONDITION = "MentionedCondition"
SYMPTOM = "Symptom"
CARE_EVENT = "CareEvent"

CARE_ONTOLOGY = OntologyDocument(
    domain=DomainInfo(id="dawa-care", name="dawa-care"),
    entity_types=[
        EntityTypeDef(label=CARE_RECIPIENT, pole_type="PERSON", subtype="CARE_RECIPIENT",
                      description="The older adult whose medicines are being managed."),
        EntityTypeDef(label=CAREGIVER, pole_type="PERSON", subtype="CAREGIVER",
                      description="A family member or professional who looks after the care recipient."),
        EntityTypeDef(label=MENTIONED_DRUG, pole_type="OBJECT", subtype="DRUG",
                      description="A medicine or supplement named in a note, by brand or generic name."),
        EntityTypeDef(label=MENTIONED_FOOD, pole_type="OBJECT", subtype="FOOD",
                      description="A food or drink habit named in a note."),
        EntityTypeDef(label=MENTIONED_CONDITION, pole_type="OBJECT", subtype="CONDITION",
                      description="A diagnosed condition named in a note."),
        EntityTypeDef(label=SYMPTOM, pole_type="OBJECT", subtype="SYMPTOM",
                      description="Something the caregiver observed: dizziness, bruising, confusion."),
        EntityTypeDef(label=CARE_EVENT, pole_type="EVENT", subtype="CARE_EVENT",
                      description="Something that happened: a fall, hospital visit, missed dose."),
    ],
    relationships=[
        RelationshipDef(type="TAKES", source=CARE_RECIPIENT, target=MENTIONED_DRUG),
        RelationshipDef(type="CONSUMES", source=CARE_RECIPIENT, target=MENTIONED_FOOD),
        RelationshipDef(type="HAS_CONDITION", source=CARE_RECIPIENT, target=MENTIONED_CONDITION),
        RelationshipDef(type="EXPERIENCED", source=CARE_RECIPIENT, target=SYMPTOM),
        RelationshipDef(type="EXPERIENCED", source=CARE_RECIPIENT, target=CARE_EVENT),
        RelationshipDef(type="CARES_FOR", source=CAREGIVER, target=CARE_RECIPIENT),
    ],
)

# Words a caregiver uses for observations and events. Matched as whole words in notes.
SYMPTOM_TERMS = [
    "dizzy", "dizziness", "bruise", "bruising", "bleeding", "nosebleed", "confused", "confusion",
    "drowsy", "drowsiness", "nausea", "rash", "cramps", "muscle pain", "black stools", "tired",
    "fatigue", "swelling", "headache", "palpitations", "heartburn",
]
EVENT_TERMS = [
    "fall", "fell", "hospital", "er visit", "emergency", "missed dose", "double dose",
    "admitted", "discharged", "blood test", "inr",
]
