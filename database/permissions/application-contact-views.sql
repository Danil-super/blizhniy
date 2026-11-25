-- Apply with the hosted web cutover after the contact evidence migration.
grant insert(application_id,recipient_id) on app.application_contact_views to blizhniy_runtime;
