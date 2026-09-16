'use strict';
const {createAutonomousMissionOrchestrator}=require('./orchestrator');
const {createUniversalExecutor}=require('./universal-executor');
function createUniversalMissionRunner({missionStore,planner,replanner=null,verify,activation,deviceDispatcher,agentExecutors={},easClient=null,policy={},selfImprovement=null,now}={}){const executor=createUniversalExecutor({activation,deviceDispatcher,agentExecutors,easClient,selfImprovement});const orchestrator=createAutonomousMissionOrchestrator({missionStore,planner,replanner,executor:executor.execute,verify,policy,now});return Object.freeze({executor,orchestrator,run:orchestrator.run,policy:orchestrator.policy,limits:orchestrator.limits});}
module.exports=Object.freeze({createUniversalMissionRunner});
