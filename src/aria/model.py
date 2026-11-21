# -*- coding: utf-8 -*-
"""
    model
    ~~~~
    ARIA model implementation.
"""
from aria.exceptions import ModelException
class Model:
    def __init__(self, name: str, version: str, agent: object | None = None):
        self.name = name
        self.version = version
        self.agent = agent
    def set_agent(self, agent: object):
        """Set the agent for this model.
        Args:
            agent: The agent object.
        """
        self.agent = agent
    def get_instance(self, input_data: any) -> object:
        """Get an instance of the model.
        Args:
            input_data: The input data for the model.
        Returns:
            An instance of the model.
        Raises:
            ModelException: If the agent is not set or if there is an error getting the instance.
        """
        if self.agent is None:
            raise ModelException("Agent not set for model.")
        try:
            return self.agent.get_model_instance(self, input_data)
        except Exception as e:
            raise ModelException(f"Error getting model instance from agent: {e}")
    def run(self, input_data: any) -> any:
        """Run the model with the given input data.
        Args:
            input_data: The input data for the model.
        Returns:
            The output of the model.
        Raises:
            ModelException: If there is an error running the model.
        """
        try:
            instance = self.get_instance(input_data)
            return instance.run(input_data)
        except ModelException:
            raise
        except Exception as e:
            raise ModelException(f"Error running model instance: {e}")
