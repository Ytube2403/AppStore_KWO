CREATE OR REPLACE FUNCTION bulk_update_keywords_fast(
  ids uuid[],
  best_ranks integer[],
  ranked_counts integer[],
  topn_counts integer[],
  is_quals boolean[],
  rel_scores numeric[],
  total_scores numeric[]
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  -- An UNNEST implementation is typically much faster than parsing JSON
  -- because we bypass the JSON parser and allow planner to use index scans easily.
  UPDATE "keywords" AS k
  SET 
    competitor_best_rank = d.best_rank,
    competitor_ranked_count = d.ranked_count,
    competitor_topn_count = d.topn_count,
    is_qualified = d.is_qual,
    relevancy_score = d.rel_score,
    total_score = d.tot_score
  FROM (
    SELECT 
      unnest(ids) AS id,
      unnest(best_ranks) AS best_rank,
      unnest(ranked_counts) AS ranked_count,
      unnest(topn_counts) AS topn_count,
      unnest(is_quals) AS is_qual,
      unnest(rel_scores) as rel_score,
      unnest(total_scores) as tot_score
  ) AS d
  WHERE k.id = d.id;
END;
$$;
