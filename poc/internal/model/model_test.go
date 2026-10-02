package model

import (
	"testing"

	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/descriptorpb"
)

func TestBuildListsLocalSymbolsAndSkipsDependencyProtos(t *testing.T) {
	set := &descriptorpb.FileDescriptorSet{
		File: []*descriptorpb.FileDescriptorProto{
			{
				Name:    proto.String("acme/widget/v1/widget.proto"),
				Package: proto.String("acme.widget.v1"),
				Syntax:  proto.String("proto3"),
				MessageType: []*descriptorpb.DescriptorProto{
					{
						Name: proto.String("Widget"),
						Field: []*descriptorpb.FieldDescriptorProto{
							{
								Name:     proto.String("id"),
								JsonName: proto.String("id"),
								Number:   proto.Int32(1),
								Label:    descriptorpb.FieldDescriptorProto_LABEL_OPTIONAL.Enum(),
								Type:     descriptorpb.FieldDescriptorProto_TYPE_STRING.Enum(),
							},
							{
								Name:     proto.String("tag"),
								JsonName: proto.String("tag"),
								Number:   proto.Int32(2),
								Label:    descriptorpb.FieldDescriptorProto_LABEL_REPEATED.Enum(),
								Type:     descriptorpb.FieldDescriptorProto_TYPE_STRING.Enum(),
							},
							{
								Name:       proto.String("team"),
								JsonName:   proto.String("team"),
								Number:     proto.Int32(3),
								Label:      descriptorpb.FieldDescriptorProto_LABEL_OPTIONAL.Enum(),
								Type:       descriptorpb.FieldDescriptorProto_TYPE_STRING.Enum(),
								OneofIndex: proto.Int32(0),
							},
						},
						NestedType: []*descriptorpb.DescriptorProto{
							{
								Name: proto.String("Part"),
								Field: []*descriptorpb.FieldDescriptorProto{
									{
										Name:     proto.String("sku"),
										JsonName: proto.String("sku"),
										Number:   proto.Int32(1),
										Label:    descriptorpb.FieldDescriptorProto_LABEL_OPTIONAL.Enum(),
										Type:     descriptorpb.FieldDescriptorProto_TYPE_STRING.Enum(),
									},
								},
							},
						},
						OneofDecl: []*descriptorpb.OneofDescriptorProto{{Name: proto.String("owner")}},
					},
				},
				EnumType: []*descriptorpb.EnumDescriptorProto{
					{
						Name: proto.String("State"),
						Value: []*descriptorpb.EnumValueDescriptorProto{
							{Name: proto.String("STATE_UNSPECIFIED"), Number: proto.Int32(0)},
							{Name: proto.String("STATE_ACTIVE"), Number: proto.Int32(1)},
						},
					},
				},
				Service: []*descriptorpb.ServiceDescriptorProto{
					{
						Name: proto.String("WidgetService"),
						Method: []*descriptorpb.MethodDescriptorProto{
							{
								Name:       proto.String("GetWidget"),
								InputType:  proto.String(".acme.widget.v1.Widget"),
								OutputType: proto.String(".acme.widget.v1.Widget"),
							},
						},
					},
				},
			},
			{
				Name:    proto.String("google/protobuf/timestamp.proto"),
				Package: proto.String("google.protobuf"),
				Syntax:  proto.String("proto3"),
				MessageType: []*descriptorpb.DescriptorProto{
					{Name: proto.String("Timestamp")},
				},
			},
		},
	}
	raw, err := proto.Marshal(set)
	if err != nil {
		t.Fatal(err)
	}
	got, err := Build(raw, "Widgets")
	if err != nil {
		t.Fatal(err)
	}
	if got.Title != "Widgets" {
		t.Fatalf("title %q", got.Title)
	}
	if len(got.Files) != 1 || got.Files[0].Path != "acme/widget/v1/widget.proto" {
		t.Fatalf("files %#v", got.Files)
	}
	if len(got.Messages) != 2 {
		t.Fatalf("messages %#v", got.Messages)
	}
	widget := got.Messages[0]
	if widget.FullName != "acme.widget.v1.Widget" || got.Messages[1].FullName != "acme.widget.v1.Widget.Part" {
		t.Fatalf("message order %#v", got.Messages)
	}
	if widget.URLPath != "/reference/messages/acme.widget.v1.Widget/" {
		t.Fatalf("url %s", widget.URLPath)
	}
	if len(widget.Fields) != 3 || widget.Fields[0].Type != "string" || widget.Fields[1].Type != "repeated string" {
		t.Fatalf("fields %#v", widget.Fields)
	}
	if widget.Fields[2].Oneof != "owner" {
		t.Fatalf("oneof %#v", widget.Fields[2])
	}
	if len(got.Enums) != 1 || got.Enums[0].Values[1].Name != "STATE_ACTIVE" {
		t.Fatalf("enums %#v", got.Enums)
	}
	if len(got.Services) != 1 || got.Services[0].Methods[0].Name != "GetWidget" {
		t.Fatalf("services %#v", got.Services)
	}
}

func TestIncludeFile(t *testing.T) {
	if IncludeFile("google/protobuf/timestamp.proto") || IncludeFile("buf/validate/validate.proto") || IncludeFile("cybozu/validate/options.proto") {
		t.Fatal("dependency protos should be omitted")
	}
	if !IncludeFile("acme/widget/v1/widget.proto") {
		t.Fatal("module proto should be included")
	}
}
