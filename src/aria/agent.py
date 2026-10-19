# -*- coding: utf-8 -*-
"""
    agent
    ~~~~
    ARIA agent implementation.
"""
from aria.registry import Registry
from aria.model import Model
from aria.exceptions import AgentException
class Agent:
    def __init__(self, registry: Registry):
        self.registry = registry
    def run_model(self, name: str, version: str, input_data: any) -> any:
        """Run a model from the registry.
        Args:
            name: The name of the model.
            version: The version of the model.
            input_data: The input data for the model.
        Returns:
            The output of the model.
        Raises:
            AgentException: If the model is not found or if there is an error running the model.
        """
        model = self.registry.get_model(name, version)
        if model is None:
            raise AgentException(f"Model \'{name}\' version \'{version}\' not found in registry.")
        try:
            instance = model.get_instance(input_data)
            return instance.run(input_data)
        except Exception as e:
            raise AgentException(f"Error running model \'{name}\' version \'{version}\': {e}")
    def list_models(self) -> list:
        """List all models in the registry.
        Returns:
            A list of model names.
        """
        return [model.name for model in self.registry.models]
    def register_model(self, model: Model):
        """Register a model with the registry.
        Args:
            model: The model to register.
        Raises:
            AgentException: If the model is already registered.
        """
        try:
            self.registry.register_model(model)
        except Exception as e:
            raise AgentException(f"Error registering model \'{model.name}\' version \'{model.version}\': {e}")
    def unregister_model(self, name: str, version: str):
        """Unregister a model from the registry.
        Args:
            name: The name of the model.
            version: The version of the model.
        Raises:
            AgentException: If the model is not found.
        """
        try:
            self.registry.unregister_model(name, version)
        except Exception as e:
            raise AgentException(f"Error unregistering model \'{name}\' version \'{version}\': {e}")
