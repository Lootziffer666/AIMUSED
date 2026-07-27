#!/usr/bin/env python3
"""Builds reranker-v1.onnx – the reference model for the MUSE ranker contract.

The committed .onnx is 3.6 kB and deliberately *untrained*: its weights are a
fixed random projection. It proves that the contract holds end to end – input
names, tensor shapes, dtypes, output name – not that it has musical judgement.
Anything claiming the latter has to come with training records.

    pip install onnx
    python3 fixtures/tonemap/synthetic/make-reranker.py
"""

import os

import numpy as np
import onnx
from onnx import TensorProto, helper, numpy_helper

N_FEATURES = 97  # muse.feature-layout.v1
N_SLOTS = 8  # scores for up to eight shortlist positions
OUT = os.path.join(os.path.dirname(__file__), "reranker-v1.onnx")

rng = np.random.default_rng(20260727)  # fixed seed: the file is reproducible
W = (rng.standard_normal((N_FEATURES, N_SLOTS)) * 0.05).astype(np.float32)
b = np.linspace(0.6, -0.2, N_SLOTS).astype(np.float32)  # mild positional prior

nodes = [
    # A masked feature is not a zero feature: multiply before anything else.
    helper.make_node("Mul", ["features", "mask"], ["masked"]),
    helper.make_node("MatMul", ["masked", "W"], ["projected"]),
    helper.make_node("Add", ["projected", "b"], ["logits"]),
    helper.make_node("Sigmoid", ["logits"], ["scores"]),
]

graph = helper.make_graph(
    nodes,
    "muse-patch-reranker",
    inputs=[
        helper.make_tensor_value_info("features", TensorProto.FLOAT, [1, N_FEATURES]),
        helper.make_tensor_value_info("mask", TensorProto.FLOAT, [1, N_FEATURES]),
    ],
    outputs=[helper.make_tensor_value_info("scores", TensorProto.FLOAT, [1, N_SLOTS])],
    initializer=[numpy_helper.from_array(W, "W"), numpy_helper.from_array(b, "b")],
)

model = helper.make_model(
    graph,
    producer_name="muse-tonemap",
    opset_imports=[helper.make_opsetid("", 13)],
)
model.ir_version = 9
model.doc_string = (
    "Reference model for the MUSE patch ranker contract muse.feature-layout.v1. "
    "Inputs features/mask [1,97] float32, output scores [1,8]. Untrained: the "
    "weights are a fixed random projection, so this proves the contract, not "
    "musical judgement."
)

onnx.checker.check_model(model)
onnx.save(model, OUT)
print(f"{OUT}: {os.path.getsize(OUT)} bytes")
