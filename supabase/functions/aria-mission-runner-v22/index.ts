    const recalled = await recall(String(mission.goal || ""), token);
    const previousRecovery = mission?.checkpoint?.recovery && typeof mission.checkpoint.recovery === "object"
      ? mission.checkpoint.recovery
      : null;
    const cognitiveContext = {
      version: "cognitive-loop-v2",
      available: recalled.available,
      recall_count: recalled.results.length,
      memory_ids: recalled.results.map((item: any) => item.memory_id || item.id).filter(Boolean),
      // A mission's persisted project/visual intent must survive the runner -> planner handoff.
      // Without these fields, ARTIA missions fall through to generic planning and can pause
      // with planner_empty_steps instead of getting the visual-project governed route.
      project_id: typeof mission?.metadata?.project_id === "string"
        ? mission.metadata.project_id
        : (typeof mission?.project_id === "string" ? mission.project_id : null),
      visual_context: mission?.metadata?.visual_context && typeof mission.metadata.visual_context === "object"
        ? mission.metadata.visual_context
        : (mission?.checkpoint?.visual_context && typeof mission.checkpoint.visual_context === "object"
          ? mission.checkpoint.visual_context
          : (mission?.visual_context && typeof mission.visual_context === "object" ? mission.visual_context : null)),
      mission_planner_contract: {
        requested_capability: typeof mission?.metadata?.requested_capability === "string" ? mission.metadata.requested_capability : null,
        requested_device_id: typeof mission?.metadata?.requested_device_id === "string" ? mission.metadata.requested_device_id : (typeof mission?.metadata?.device_id === "string" ? mission.metadata.device_id : null),
        verification_marker: typeof mission?.metadata?.verification_marker === "string" ? mission.metadata.verification_marker : null,
        command: typeof mission?.metadata?.command === "string" ? mission.metadata.command : null,
        cwd: typeof mission?.metadata?.cwd === "string" ? mission.metadata.cwd : null,
        start_url: typeof mission?.metadata?.start_url === "string" ? mission.metadata.start_url : null,
        timeout_ms: Number.isInteger(mission?.metadata?.timeout_ms) ? mission.metadata.timeout_ms : null,
        risk: typeof mission?.metadata?.risk === "string" ? mission.metadata.risk : null,
        source: typeof mission?.metadata?.source === "string" ? mission.metadata.source : null,
        roadmap_block: typeof mission?.metadata?.roadmap_block === "string" ? mission.metadata.roadmap_block : null,
      },
      recovery: previousRecovery?.replan_required === true ? {
        replan_required: true,
        replan_count: Number(previousRecovery?.replan_count || 0),
        failure_reason: previousRecovery?.failure_reason || null,
        failed_step_ids: Array.isArray(previousRecovery?.failed_step_ids) ? previousRecovery.failed_step_ids : [],
        failed_step_details: previousRecovery?.block_details || null,
        previous_plan_summary: Array.isArray(previousRecovery?.previous_plan)
          ? previousRecovery.previous_plan.map((step: any) => ({
              id: step?.id,
              executor_type: step?.executor_type,
              operation: step?.operation,
              risk: step?.risk,
              target: step?.target,
            })).slice(0, 20)
          : [],
      } : null,
    };
    await emitEvent(missionId, "cognitive_recall_completed", cognitiveContext);

    let steps: any[];