CREATE OR REPLACE FUNCTION bulk_update_keywords(payload json)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE "keywords" AS k
  SET 
    competitor_best_rank = t.competitor_best_rank,
    competitor_ranked_count = t.competitor_ranked_count,
    competitor_topn_count = t.competitor_topn_count,
    is_qualified = t.is_qualified,
    relevancy_score = t.relevancy_score,
    total_score = t.total_score
  FROM json_to_recordset(payload) AS t(
    id uuid,
    competitor_best_rank integer,
    competitor_ranked_count integer,
    competitor_topn_count integer,
    is_qualified boolean,
    relevancy_score numeric,
    total_score numeric
  )
  WHERE k.id = t.id;
END;
$$;
