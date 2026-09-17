# ARIA Worker - Handles critical credential validation and live evidence logging.

import logging
from typing import Dict, Any
import datetime

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

class ARIAWorker:
    """
    Manages the validation of critical ARIA credentials and logs live evidence.
    Ensures availability, expiration, scope, and revocation status are monitored
    without exposing sensitive secrets.
    """

    def __init__(self):
        """Initializes the ARIAWorker."""
        self.credentials: Dict[str, Dict[str, Any]] = {}
        logging.info("ARIAWorker initialized.")

    def add_credential(self, credential_id: str, credential_data: Dict[str, Any]):
        """
        Adds a new critical credential to be managed.

        Args:
            credential_id: Unique identifier for the credential.
            credential_data: Dictionary containing credential details (e.g.,
                             'expiry', 'scope', 'status', 'is_revoked').
                             'status' can be 'active', 'inactive'.
                             'is_revoked' should be a boolean.
        """
        if not isinstance(credential_id, str) or not credential_id:
            logging.error("Invalid credential_id provided. Must be a non-empty string.")
            return
        if not isinstance(credential_data, dict):
            logging.error(f"Invalid credential_data for {credential_id}. Must be a dictionary.")
            return

        self.credentials[credential_id] = credential_data
        logging.info(f"Credential '{credential_id}' added.")

    def validate_credential(self, credential_id: str) -> Dict[str, Any]:
        """
        Validates a specific credential and returns its live status.

        Args:
            credential_id: The ID of the credential to validate.

        Returns:
            A dictionary containing the validation status, including:
            'credential_id': The ID of the credential.
            'is_available': Boolean indicating if the credential is active.
            'is_expired': Boolean indicating if the credential has expired.
            'scope': The scope of the credential.
            'is_revoked': Boolean indicating if the credential has been revoked.
            'status': The current status ('active' or 'inactive').
            'validation_time': Timestamp of the validation.
            'error': Error message if validation failed, otherwise None.
        """
        validation_result = {
            'credential_id': credential_id,
            'is_available': False,
            'is_expired': False,
            'scope': None,
            'is_revoked': False,
            'status': 'inactive',
            'validation_time': None,
            'error': None
        }

        if credential_id not in self.credentials:
            validation_result['error'] = "Credential not found."
            logging.error(f"Validation failed for '{credential_id}': Credential not found.")
            return validation_result

        cred_data = self.credentials[credential_id]
        current_time = datetime.datetime.now()
        validation_result['validation_time'] = current_time.isoformat()

        # Check for expiration
        expiry_time_str = cred_data.get('expiry')
        if expiry_time_str:
            try:
                expiry_time = datetime.datetime.fromisoformat(expiry_time_str)
                if current_time > expiry_time:
                    validation_result['is_expired'] = True
                    logging.warning(f"Credential '{credential_id}' has expired.")
            except ValueError:
                validation_result['error'] = "Invalid expiry format. Expected ISO format."
                logging.error(f"Validation failed for '{credential_id}': Invalid expiry format.")
                # No return here, continue to check other fields if possible

        # Check for revocation
        is_revoked = cred_data.get('is_revoked', False)
        if is_revoked:
            validation_result['is_revoked'] = True
            logging.warning(f"Credential '{credential_id}' has been revoked.")

        # Check status and availability
        status = cred_data.get('status', 'inactive')
        validation_result['status'] = status
        if status == 'active' and not validation_result['is_expired'] and not validation_result['is_revoked']:
            validation_result['is_available'] = True

        # Get scope
        validation_result['scope'] = cred_data.get('scope')

        if validation_result['is_available']:
            logging.info(f"Credential '{credential_id}' is active and valid.")
        else:
            logging.warning(f"Credential '{credential_id}' is not available or has issues.")

        return validation_result

    def get_all_credentials_status(self) -> Dict[str, Dict[str, Any]]:
        """
        Validates all managed credentials and returns their live status.

        Returns:
            A dictionary where keys are credential IDs and values are their
            validation status dictionaries.
        """
        all_statuses = {}
        for cred_id in self.credentials:
            all_statuses[cred_id] = self.validate_credential(cred_id)
        logging.info("Retrieved status for all managed credentials.")
        return all_statuses

# Example Usage (for demonstration purposes)
if __name__ == "__main__":
    worker = ARIAWorker()

    # Add some sample credentials
    worker.add_credential("cred1", {
        "expiry": "2024-12-31T23:59:59",
        "scope": "read:data",
        "status": "active",
        "is_revoked": False
    })
    worker.add_credential("cred2", {
        "expiry": "2023-01-01T00:00:00", # Expired credential
        "scope": "write:logs",
        "status": "active",
        "is_revoked": False
    })
    worker.add_credential("cred3", {
        "expiry": "2025-06-15T12:00:00",
        "scope": "admin",
        "status": "active",
        "is_revoked": True # Revoked credential
    })
    worker.add_credential("cred4", {
        "expiry": "2026-01-01T00:00:00",
        "scope": "read:users",
        "status": "inactive", # Inactive credential
        "is_revoked": False
    })
    worker.add_credential("cred5", {
        "expiry": "invalid-date", # Invalid expiry format
        "scope": "read:config",
        "status": "active",
        "is_revoked": False
    })

    # Validate a single credential
    print("--- Validating cred1 ---")
    status_cred1 = worker.validate_credential("cred1")
    print(status_cred1)

    print("\n--- Validating non-existent credential ---")
    status_nonexistent = worker.validate_credential("nonexistent_cred")
    print(status_nonexistent)

    # Get status of all credentials
    print("\n--- Getting status of all credentials ---")
    all_statuses = worker.get_all_credentials_status()
    for cred_id, status in all_statuses.items():
        print(f"{cred_id}: {status}")

    # Example of adding invalid data
    print("\n--- Adding invalid credential data ---")
    worker.add_credential("invalid_cred_id", None) # type: ignore
    worker.add_credential("", {"expiry": "2024-01-01", "scope": "test", "status": "active", "is_revoked": False})
    worker.add_credential("cred6", "not a dict") # type: ignore

    print("\n--- Validating invalid credential data ---")
    status_invalid_data = worker.validate_credential("cred5") # Testing invalid date format
    print(status_invalid_data)
    status_invalid_data_2 = worker.validate_credential("cred1") # Re-validate to show it's still fine
    print(status_invalid_data_2)
    print("\n--- Final status of all credentials ---")
    all_statuses_final = worker.get_all_credentials_status()
    for cred_id, status in all_statuses_final.items():
        print(f"{cred_id}: {status}")
