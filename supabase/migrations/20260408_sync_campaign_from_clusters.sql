-- Function to sync campaign_id from clusters to messages
-- This ensures messages inherit their cluster's campaign_id when the message's campaign_id is NULL

CREATE OR REPLACE FUNCTION sync_campaign_from_clusters()
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  updated_count INTEGER;
BEGIN
  -- Update messages that have NULL campaign_id but their cluster has a campaign_id
  UPDATE messages m
  SET campaign_id = c.campaign_id
  FROM message_clusters c
  WHERE m.cluster_id = c.id
    AND m.campaign_id IS NULL
    AND c.campaign_id IS NOT NULL;
  
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION sync_campaign_from_clusters() TO authenticated;
GRANT EXECUTE ON FUNCTION sync_campaign_from_clusters() TO service_role;

-- Create a trigger to automatically sync campaign_id when a cluster gets assigned a campaign
CREATE OR REPLACE FUNCTION trigger_sync_campaign_to_messages()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- When a cluster gets a campaign_id assigned, update all its messages
  IF NEW.campaign_id IS NOT NULL AND (OLD.campaign_id IS NULL OR OLD.campaign_id != NEW.campaign_id) THEN
    UPDATE messages
    SET campaign_id = NEW.campaign_id
    WHERE cluster_id = NEW.id
      AND campaign_id IS NULL;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Drop trigger if it exists and recreate
DROP TRIGGER IF EXISTS sync_campaign_to_messages_on_cluster_update ON message_clusters;

CREATE TRIGGER sync_campaign_to_messages_on_cluster_update
  AFTER UPDATE ON message_clusters
  FOR EACH ROW
  WHEN (NEW.campaign_id IS NOT NULL)
  EXECUTE FUNCTION trigger_sync_campaign_to_messages();

-- Also create a trigger for when a message is assigned to a cluster
CREATE OR REPLACE FUNCTION trigger_sync_campaign_on_cluster_assignment()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  cluster_campaign_id INTEGER;
BEGIN
  -- When a message gets assigned to a cluster, inherit the cluster's campaign_id if message has NULL
  IF NEW.cluster_id IS NOT NULL AND NEW.campaign_id IS NULL THEN
    SELECT campaign_id INTO cluster_campaign_id
    FROM message_clusters
    WHERE id = NEW.cluster_id
      AND campaign_id IS NOT NULL;
    
    IF cluster_campaign_id IS NOT NULL THEN
      NEW.campaign_id := cluster_campaign_id;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Drop trigger if it exists and recreate
DROP TRIGGER IF EXISTS sync_campaign_on_message_cluster_assignment ON messages;

CREATE TRIGGER sync_campaign_on_message_cluster_assignment
  BEFORE INSERT OR UPDATE OF cluster_id ON messages
  FOR EACH ROW
  WHEN (NEW.cluster_id IS NOT NULL)
  EXECUTE FUNCTION trigger_sync_campaign_on_cluster_assignment();
