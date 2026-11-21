# -*- coding: utf-8 -*-
"""
    registry
    ~~~~~~~~~
    ARIA registry implementation.
"""
from aria.model import Model
from aria.exceptions import RegistryException
class Registry:
    def __init__(self):
        self.models = []
    def register_model(self, model: Model):
        """Register a model with the registry.
        Args:
            model: The model to register.
        Raises:
            RegistryException: If the model is already registered.
        """
        for existing_model in self.models:
            if existing_model.name == model.name and existing_model.version == model.version:
                raise RegistryException(f"Model \'{model.name}\' version \'{model.version}\' already registered.")
        self.models.append(model)
    def get_model(self, name: str, version: str) -> Model | None:
        """Get a model from the registry.
        Args:
            name: The name of the model.
            version: The version of the model.
        Returns:
            The model if found, otherwise None.
        """
        for model in self.models:
            if model.name == name and model.version == version:
                return model
        return None
    def unregister_model(self, name: str, version: str):
        """Unregister a model from the registry.
        Args:
            name: The name of the model.
            version: The version of the model.
        Raises:
            RegistryException: If the model is not found.
        """
        model_to_remove = self.get_model(name, version)
        if model_to_remove is None:
            raise RegistryException(f"Model \'{name}\' version \'{version}\' not found in registry.")
        self.models.remove(model_to_remove)
    def list_models(self) -> list:
        """List all models in the registry.
        Returns:
            A list of model names and versions.
        """
        return [f"{model.name}=={model.version}" for model in self.models]
    def get_models_by_name(self, name: str) -> list:
        """Get all models with a given name.
        Args:
            name: The name of the model.
        Returns:
            A list of models with the given name.
        """
        return [model for model in self.models if model.name == name]
