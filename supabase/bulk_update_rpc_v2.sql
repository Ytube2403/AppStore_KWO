-- Optimized version of bulk update using JSON array arrays instead of a complex JSON set, 
-- which allows Postgres to better use the primary key index.

DROP FUNCTION IF EXISTS bulk_update_keywords(json);

CREATE OR REPLACE FUNCTION bulk_update_keywords(payload json)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  -- We parse the json straight into an UPDATE FROM VALUES structure,
  -- but utilizing json_populate_recordset can be slow. 
  -- Creating a Temp Table or using a CTE is more robust for index usage.
  
  WITH data AS (
    SELECT * FROM json_to_recordset(payload) AS t(
      id uuid,
      competitor_best_rank integer,
      competitor_ranked_count integer,
      competitor_topn_count integer,
      is_qualified boolean,
      relevancy_score numeric,
      total_score numeric
    )
  )
  UPDATE "keywords" AS k
  SET 
    competitor_best_rank = d.competitor_best_rank,
    competitor_ranked_count = d.competitor_ranked_count,
    competitor_topn_count = d.competitor_topn_count,
    is_qualified = d.is_qualified,
    relevancy_score = d.relevancy_score,
    total_score = d.total_score
  FROM data AS d
  WHERE k.id = d.id;
END;
$$;
