-- Disable the application flag before revoking. Stored preferences are retained.
revoke select(contact_method),update(contact_method) on app.listings from blizhniy_runtime;
