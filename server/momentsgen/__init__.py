"""Put a character into a real video clip, using open-source models."""

from .insert import Placement, insert_character, load_pipeline, prepare_reference

__all__ = ["Placement", "insert_character", "load_pipeline", "prepare_reference"]
