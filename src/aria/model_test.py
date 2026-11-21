# -*- coding: utf-8 -*-
"""
    model_test
    ~~~~~~~~~~
    Test cases for the ARIA model.
"""
import unittest
from unittest.mock import MagicMock
from aria.model import Model
from aria.exceptions import ModelException
class ModelTest(unittest.TestCase):
    def setUp(self):
        self.model = Model(name="test_model", version="1.0", agent=None)
    def test_model_initialization(self):
        self.assertEqual(self.model.name, "test_model")
        self.assertEqual(self.model.version, "1.0")
        self.assertIsNone(self.model.agent)
    def test_model_set_agent(self):
        mock_agent = MagicMock()
        self.model.set_agent(mock_agent)
        self.assertEqual(self.model.agent, mock_agent)
    def test_model_get_instance_success(self):
        mock_agent = MagicMock()
        self.model.set_agent(mock_agent)
        mock_agent.get_model_instance.return_value = "mock_instance"
        instance = self.model.get_instance("test_input")
        mock_agent.get_model_instance.assert_called_once_with(self.model, "test_input")
        self.assertEqual(instance, "mock_instance")
    def test_model_get_instance_agent_not_set(self):
        with self.assertRaises(ModelException) as cm:
            self.model.get_instance("test_input")
        self.assertEqual(str(cm.exception), "Agent not set for model.")
    def test_model_get_instance_agent_error(self):
        mock_agent = MagicMock()
        self.model.set_agent(mock_agent)
        mock_agent.get_model_instance.side_effect = Exception("Agent error")
        with self.assertRaises(ModelException) as cm:
            self.model.get_instance("test_input")
        self.assertEqual(str(cm.exception), "Error getting model instance from agent: Agent error")
    def test_model_run_success(self):
        mock_instance = MagicMock()
        mock_instance.run.return_value = "run_success"
        with unittest.mock.patch.object(self.model, 'get_instance', return_value=mock_instance) as mock_get_instance:
            result = self.model.run("test_input")
            mock_get_instance.assert_called_once_with("test_input")
            mock_instance.run.assert_called_once_with("test_input")
            self.assertEqual(result, "run_success")
    def test_model_run_get_instance_failed(self):
        with unittest.mock.patch.object(self.model, 'get_instance', side_effect=ModelException("Failed to get instance")) as mock_get_instance:
            with self.assertRaises(ModelException) as cm:
                self.model.run("test_input")
            mock_get_instance.assert_called_once_with("test_input")
            self.assertEqual(str(cm.exception), "Failed to get instance")
    def test_model_run_instance_run_failed(self):
        mock_instance = MagicMock()
        mock_instance.run.side_effect = Exception("Instance run error")
        with unittest.mock.patch.object(self.model, 'get_instance', return_value=mock_instance) as mock_get_instance:
            with self.assertRaises(ModelException) as cm:
                self.model.run("test_input")
            mock_get_instance.assert_called_once_with("test_input")
            mock_instance.run.assert_called_once_with("test_input")
            self.assertEqual(str(cm.exception), "Error running model instance: Instance run error")
if __name__ == '__main__':
    unittest.main()
