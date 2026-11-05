-- Which count a connected account's pages use: 'auto' (whichever has more votes in), 'ddhq' or 'civic'.
ALTER TABLE ddhq_connections ADD COLUMN results_source TEXT NOT NULL DEFAULT 'auto';
