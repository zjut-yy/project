from .. import agent_internvideo_server as legacy

TimeConstraint = legacy.TimeConstraint
SpatialConstraint = legacy.SpatialConstraint
BehaviorConstraint = legacy.BehaviorConstraint
QueryIntent = legacy.QueryIntent
ClusterResult = legacy.ClusterResult

__all__ = [
    "BehaviorConstraint",
    "ClusterResult",
    "QueryIntent",
    "SpatialConstraint",
    "TimeConstraint",
]
